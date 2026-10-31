import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createStore } from '../claude/sessions/store.js';
import { describeTool } from '../claude/sessions/activity.js';
import { log } from '../log.js';
import { CODEX_HOME, CODEX_POLL_MS, CODEX_LIMIT } from './config.js';
import { createRpc } from './rpc.js';
import { createRolloutReader, applyRecord, questionFrom } from './rollout.js';
import { normalizeUsage } from './usage.js';
import { createTitleIndex, sessionName } from './titles.js';
import { createDesktopPermissions } from './permissions.js';
import { createCompactions } from './compactions.js';
import { createDesktopControl } from './desktop.js';
import { fileURLToPath } from 'node:url';

export function createCodex({ onChange = () => {}, rpc = createRpc(), pollMs = CODEX_POLL_MS, home = CODEX_HOME,
  compactFile = process.env.DASHD_COMPACT_FILE || fileURLToPath(new URL('../../.compact.json', import.meta.url)), compactControl,
  permissionControl = createDesktopControl({ home }) } = {}) {
  const state = { sessions: [], details: {}, usage: null };
  const store = createStore();
  const records = new Map();
  const questions = new Map();
  const closed = new Set();
  const titleIndex = createTitleIndex({ home });
  let stopped = false, timer = null, usageTs = 0, lastError = '', lastHookTs = 0;

  function emit(topic, data) {
    const t = topic.replace(/^claude\./, 'codex.');
    onChange(t, data);
  }
  store.onSnapshot = (snap) => { state.sessions = snap.sessions; onChange('codex.sessions.update', snap); };
  store.onDetail = (d) => {
    if (d.ended) delete state.details[d.id]; else state.details[d.id] = d;
    onChange('codex.session.update', d);
  };
  const permissions = createDesktopPermissions({ emit, store, control: permissionControl });
  const compactions = createCompactions({ file: compactFile, control: compactControl || createDesktopControl({ home }),
    onChange: () => onChange('codex.compact.update') });

  function record(id) {
    if (!records.has(id)) records.set(id, { reader: createRolloutReader(), value: {
      provider: 'codex', name: sessionName({ id }, titleIndex.read()), plan: [],
    }, hook: null });
    return records.get(id);
  }
  function publish(id, rec) {
    const s = rec.value;
    if (s.internal || closed.has(id)) return;
    const hook = rec.hook && rec.hook.ts >= (s.lastActivityTs || 0) ? rec.hook.fields : {};
    const fields = { ...s, ...hook };
    // A crashed/closed client may leave an unmatched task_started in history.
    // Without current hooks or fresh rollout activity, do not claim it is live.
    fields.thinking = !!fields.thinking && Date.now() - fields.lastActivityTs < 15 * 60_000;
    store.upsert(id, fields);
    const question = fields.question;
    const previous = questions.get(id);
    if (question && fields.waitingForInput && Date.now() - question.createdTs < 15 * 60_000) {
      questions.set(id, { ...question, sessionId: id, sessionName: store.get(id)?.name || 'Codex session' });
      if (previous?.id !== question.id) emit('codex.question.request', question);
    } else if (questions.delete(id)) {
      emit('codex.question.resolved', { id: previous.id });
    }
  }
  function readRollout(id, rec, file) {
    if (!file) return;
    // Never read arbitrary files sent by a hook. Only Codex's rollout trees.
    const roots = ['sessions', 'archived_sessions'].map((n) => path.join(home, n) + path.sep);
    let real;
    try { real = fs.realpathSync(file); } catch { return; }
    if (!roots.some((r) => real.startsWith(r)) || !real.endsWith('.jsonl')) return;
    if (rec.file && rec.file !== real) rec.reader = createRolloutReader();
    rec.file = real;
    rec.reader.read(real, (o) => {
      applyRecord(rec.value, o, { onUsage: (limits, ts) => {
        if (ts > usageTs) { state.usage = { ...normalizeUsage({ rateLimits: limits }, ts), stale: Date.now() - ts > 120_000 }; usageTs = ts; }
      } });
    });
  }

  async function poll() {
    if (stopped) return;
    try {
      const result = await rpc.request('thread/list', { limit: 100, sortKey: 'recency_at', sortDirection: 'desc',
        sourceKinds: ['cli', 'vscode', 'exec', 'appServer'], archived: false });
      if (stopped) return;
      const rows = (result.data || []).filter((r) => r.threadSource !== 'guardian_review' &&
        (!r.parentThreadId) && Date.now() - (r.recencyAt || r.updatedAt || r.createdAt) * 1000 < 24 * 3600_000);
      const seen = new Set();
      const titles = titleIndex.read();
      let shown = 0;
      for (const row of rows) {
        if (shown >= CODEX_LIMIT) break;
        seen.add(row.id);
        if (closed.has(row.id)) continue;
        const rec = record(row.id);
        Object.assign(rec.value, { name: sessionName(row, titles),
          cwd: row.cwd, model: row.model || rec.value.model, effort: row.reasoningEffort || rec.value.effort,
          startedTs: row.createdAt * 1000, lastActivityTs: rec.value.lastActivityTs || row.updatedAt * 1000 });
        readRollout(row.id, rec, row.path);
        // Imported Claude histories also appear in thread/list. Show one only
        // after Codex has actually run a turn in it, rather than filling the
        // grid with hundreds of imported chats and placeholder messages.
        if (!rec.value.native && row.historyMode !== 'paginated' && !rec.hook) continue;
        publish(row.id, rec);
        void permissions.watch(row.id);
        shown += 1;
      }
      for (const [id, rec] of records) {
        // A new hook may precede thread/list's persisted row. Keep it until it
        // appears. Rows that disappeared (archive, delete, age or limit) leave
        // after a short grace instead of persisting as stale tiles for a day.
        if (!seen.has(id) && Date.now() - (rec.hook?.ts || rec.value.lastActivityTs || 0) > 30_000) {
          permissions.unwatch(id); questions.delete(id);
          store.remove(id); records.delete(id); delete state.details[id];
        }
      }
      lastError = '';
      if (Date.now() - usageTs > 60_000) {
        try { state.usage = normalizeUsage(await rpc.request('account/rateLimits/read')); usageTs = Date.now(); }
        catch (e) { state.usage = state.usage ? { ...state.usage, stale: true } : { limits: [], error: e.message }; }
      }
      onChange('codex.usage.update', state.usage);
    } catch (e) {
      if (!stopped && lastError !== e.message) log('CX', `Codex connection: ${e.message}`);
      lastError = e.message;
      if (state.usage) state.usage = { ...state.usage, stale: true };
      // Already known chats remain observable while the metadata service is down.
      for (const [id, rec] of records) { try { readRollout(id, rec, rec.file); publish(id, rec); void permissions.watch(id); } catch {} }
    } finally { if (!stopped) timer = setTimeout(poll, pollMs); }
  }
  // Let dashd finish its own initialization before the first event can render.
  timer = setTimeout(poll, 0);

  return {
    state,
    asks: () => [...permissions.list(), ...questions.values()].sort((a, b) => a.createdTs - b.createdTs),
    detail: (id) => store.get(id),
    answerPermission: (id, decision) => permissions.answer(id, decision),
    compactSession(id) {
      if (!store.get(id)) throw new Error('Session is no longer available');
      return compactions.request(id);
    },
    compactions: () => compactions.snapshot(),
    // Losing the Kindle cannot change requests already visible in Codex.
    releasePermissions: () => 0,
    onHook(event, payload, res) {
      const id = payload.session_id;
      if (typeof id !== 'string' || !id) { res.writeHead(400); return res.end('{}'); }
      lastHookTs = Date.now();
      if (event === 'PermissionRequest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{}');
      }
      const rec = record(id);
      rec.value.native = true;
      if (event === 'SessionStart' || event === 'UserPromptSubmit') closed.delete(id);
      readRollout(id, rec, payload.transcript_path);
      const now = Date.now();
      const fields = { lastActivityTs: now, cwd: payload.cwd || rec.value.cwd };
      if (event === 'UserPromptSubmit') Object.assign(fields, { thinking: true, stoppedTs: null,
        lastPrompt: String(payload.prompt || '').replace(/\s+/g, ' ').slice(0, 120), waitingForInput: false });
      if (event === 'PreToolUse') Object.assign(fields, { thinking: true, stoppedTs: null,
        currentTool: payload.tool_name, activity: describeTool(payload.tool_name, payload.tool_input || {}), activityTs: now });
      if (event === 'PreToolUse' && /(^|[._])request_user_input$/.test(payload.tool_name || '')) {
        Object.assign(fields, { waitingForInput: true, question: questionFrom(payload.tool_input,
          payload.tool_use_id || payload.turn_id || id, now) });
      }
      if (event === 'PostToolUse') Object.assign(fields, { currentTool: null, activity: null, waitingForInput: false, question: null });
      if (['Stop', 'Interrupt', 'SessionEnd'].includes(event)) {
        Object.assign(fields, { thinking: false, currentTool: null, activity: null, waitingForInput: false, question: null, stoppedTs: now });
      }
      if (event === 'SessionEnd') { closed.add(id); permissions.unwatch(id); store.remove(id); delete state.details[id]; questions.delete(id); }
      rec.hook = { ts: now, fields: { ...rec.hook?.fields, ...fields } };
      publish(id, rec);
      if (store.get(id)) void permissions.watch(id);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}');
    },
    focusSession: () => new Promise((resolve) => execFile('open', ['-a', 'Codex'], { timeout: 5000 }, (err) =>
      resolve(err ? { focused: false, reason: err.message } : { focused: true, app: 'Codex', exact: false }))),
    status: () => ({ provider: 'codex', sessions: store.count(), pendingPermissions: permissions.pendingCount(), questions: questions.size,
      sources: ['codex-app-server', 'codex-rollouts', 'codex-hooks', 'codex-desktop-approvals'], error: lastError || null, hooks: lastHookTs > 0, lastHookTs: lastHookTs || null }),
    stop() { stopped = true; clearTimeout(timer); compactions.stop(); permissions.stop(); rpc.stop(); },
  };
}
