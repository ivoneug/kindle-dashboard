import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { applyRecord, createRolloutReader } from '../../src/codex/rollout.js';
import { normalizeUsage } from '../../src/codex/usage.js';
import { createCodex } from '../../src/codex/index.js';
import { sessionName, createTitleIndex } from '../../src/codex/titles.js';
import { mergeCodexHooks } from '../../scripts/codex-hooks-config.js';
import { renderDetail } from '../../src/screens/detail.js';
import { renderSessions } from '../../src/screens/sessions.js';

const record = (type, payload) => ({ type, timestamp: '2026-10-29T00:00:00Z', payload });

test('real titles take precedence over previews and folder names', () => {
  const titles = new Map([['chat', 'Реализация Kindle Dashboard']]);
  const row = { id: 'chat', preview: 'почитай документ в этой директории', cwd: '/projects/kindle-dashboard' };
  assert.equal(sessionName(row, titles), 'Реализация Kindle Dashboard');
  assert.equal(sessionName({ ...row, name: 'Renamed in Codex' }, titles), 'Renamed in Codex');
  assert.equal(sessionName({ ...row, name: 'Imported session' }, titles), 'Реализация Kindle Dashboard');
  assert.equal(sessionName(row), 'Untitled session');
  assert.equal(sessionName({ name: '<scheduled-task name="tweek-pr-review">body</scheduled-task>' }), 'Untitled session');
});

test('title index restores import titles, follows native renames and tolerates partial writes', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-titles-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, 'external_agent_session_imports.json'), JSON.stringify({ records: [
    { imported_thread_id: 'chat', title: 'Реализация Kindle Dashboard' },
    { imported_thread_id: 'review', title: 'Ревью PR Tweek' },
  ] }));
  const index = createTitleIndex({ home });
  assert.equal(index.read().get('chat'), 'Реализация Kindle Dashboard');
  const file = path.join(home, 'session_index.jsonl');
  fs.writeFileSync(file, JSON.stringify({ id: 'chat', thread_name: 'Native rename' }) + '\n');
  assert.equal(index.read().get('chat'), 'Native rename');
  fs.writeFileSync(file, '{"id":');
  assert.equal(index.read().get('chat'), 'Native rename', 'partial write keeps the last valid index');
  fs.writeFileSync(file, JSON.stringify({ id: 'chat', thread_name: 'A second rename' }) + '\n');
  assert.equal(index.read().get('chat'), 'A second rename');
  assert.equal(index.read().get('review'), 'Ревью PR Tweek');
});

test('Codex lifecycle, plan and tool output become dashboard detail', () => {
  const s = {};
  applyRecord(s, record('event_msg', { type: 'task_started', model_context_window: 200000 }));
  applyRecord(s, record('turn_context', { model: 'a-future-model', effort: 'high', approval_policy: 'on-request' }));
  applyRecord(s, record('response_item', { type: 'function_call', name: 'update_plan', call_id: 'p',
    arguments: JSON.stringify({ plan: [{ step: 'Подключить Kindle', status: 'in_progress' }] }) }));
  assert.deepEqual(s.plan, [{ content: 'Подключить Kindle', status: 'in_progress' }]);
  applyRecord(s, record('response_item', { type: 'function_call', name: 'exec_command', call_id: 'tool',
    arguments: JSON.stringify({ cmd: 'date', description: 'Read the time' }) }));
  assert.equal(s.activity, 'Read the time');
  applyRecord(s, record('response_item', { type: 'function_call_output', call_id: 'other' }));
  assert.equal(s.activity, 'Read the time');
  applyRecord(s, record('response_item', { type: 'function_call_output', call_id: 'tool' }));
  assert.equal(s.activity, null);
  applyRecord(s, record('event_msg', { type: 'task_complete', last_agent_message: '**Готово**' }));
  assert.equal(s.thinking, false);
  assert.equal(s.lastMessage, '**Готово**');
});

test('scheduled heartbeat replies show only message Markdown in details and tiles', () => {
  const message = '**Новых PR для ревью нет**; ожидающих твоего решения тоже нет.\n\n- Проверено `main`';
  const envelope = '<heartbeat><automation_id>tweek-pr-review</automation_id><decision>DONT_NOTIFY</decision><message>' + message + '</message></heartbeat>';
  for (const o of [
    record('event_msg', { type: 'agent_message', message: envelope }),
    record('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: envelope }] }),
    record('event_msg', { type: 'task_complete', last_agent_message: envelope }),
    record('event_msg', { type: 'turn_aborted', last_agent_message: envelope }),
  ]) {
    const s = { id: 'review', name: 'Ревью PR Tweek', state: 'idle' };
    applyRecord(s, o);
    assert.equal(s.lastMessage, message);
    const size = { width: 600, height: 800 };
    const detail = renderDetail({ session: s, index: 0, total: 1, orientation: 'portrait' }, size);
    const tiles = renderSessions({ sessions: [s], details: { review: s }, selected: 0, orientation: 'portrait' }, size);
    for (const html of [detail, tiles]) {
      assert.match(html, /<strong>Новых PR для ревью нет<\/strong>/);
      assert.match(html, /<code>main<\/code>/);
      assert.doesNotMatch(html, /heartbeat|automation_id|DONT_NOTIFY|tweek-pr-review|&lt;message&gt;/);
    }
    assert.match(detail, /<ul>\s*<li>/);
    assert.match(tiles, /▪ Проверено/);
  }
});

test('heartbeat extraction accepts metadata order and caps the readable message after extraction', () => {
  const s = {};
  const message = 'я'.repeat(4100);
  applyRecord(s, record('event_msg', { type: 'agent_message', message:
    '\n<heartbeat>\n<decision>NOTIFY</decision>\n<message>\n' + message +
    '\n</message>\n<automation_id>review</automation_id>\n</heartbeat>\n' }));
  assert.equal(s.lastMessage, message.slice(0, 4000));
});

test('heartbeat handling preserves examples, malformed envelopes and literal HTML safely', () => {
  const envelope = '<heartbeat><automation_id>review</automation_id><decision>DONT_NOTIFY</decision><message>Ready</message></heartbeat>';
  for (const text of [
    'Example: ' + envelope,
    '```xml\n' + envelope + '\n```',
    '`' + envelope + '`',
    envelope.slice(0, -12),
    envelope.replace('<decision>', '<unknown>').replace('</decision>', '</unknown>'),
    'see <task-id>x</task-id> and <script>alert(1)</script>',
  ]) {
    const s = {};
    applyRecord(s, record('event_msg', { type: 'agent_message', message: text }));
    assert.equal(s.lastMessage, text);
  }
  const s = { id: 'review', name: 'Review', state: 'idle' };
  applyRecord(s, record('event_msg', { type: 'agent_message', message:
    '<heartbeat><message>**Ready**\n\n```html\n<img src=x onerror=alert(1)>\n```\n\n<script>alert(1)</script></message></heartbeat>' }));
  const html = renderDetail({ session: s, index: 0, total: 1, orientation: 'portrait' }, { width: 600, height: 800 });
  assert.match(html, /<strong>Ready<\/strong>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img\b|<script>alert/);
});

test('context uses occupancy from last turn, totals remain lifetime counts', () => {
  const s = {};
  applyRecord(s, record('event_msg', { type: 'token_count', info: { model_context_window: 200000,
    total_token_usage: { input_tokens: 1000000, output_tokens: 50000, cached_input_tokens: 900000 },
    last_token_usage: { input_tokens: 40000, output_tokens: 500, total_tokens: 40500 } } }));
  assert.equal(s.tokensIn, 1000000);
  assert.equal(s.contextTokens / s.contextWindow, 0.2025);
});

test('guardian reviews are excluded and user-side text is not a reply', () => {
  const s = { lastMessage: 'reply' };
  applyRecord(s, record('session_meta', { source: { subagent: { other: 'guardian' } }, thread_source: 'guardian_review' }));
  assert.equal(s.internal, true);
  applyRecord(s, record('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'a reminder' }] }));
  assert.equal(s.lastMessage, 'reply');
});

test('rollout reader survives partial lines and UTF-8 chunk boundaries without replay', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-codex-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'rollout.jsonl');
  const text = 'я'.repeat(40000);
  const json = JSON.stringify(record('event_msg', { type: 'agent_message', message: text }));
  fs.writeFileSync(file, json.slice(0, -1));
  const reader = createRolloutReader(); const got = [];
  reader.read(file, (o) => got.push(o));
  assert.equal(got.length, 0);
  fs.appendFileSync(file, '}\n'); reader.read(file, (o) => got.push(o)); reader.read(file, (o) => got.push(o));
  assert.equal(got.length, 1); assert.equal(got[0].payload.message, text);
});

test('limits accept RPC and rollout schemas, and missing means unavailable', () => {
  const rpc = normalizeUsage({ rateLimitsByLimitId: { codex: { primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 1 } } } });
  assert.equal(rpc.limits[0].used, 0.23);
  assert.match(rpc.limits[0].label, /5 HOURS/);
  assert.equal(normalizeUsage({ rateLimits: { primary: { used_percent: 75, window_minutes: 10080 } } }).limits[0].used, 0.75);
  assert.equal(normalizeUsage({}).limits.length, 0);
  assert.ok(normalizeUsage({}).error);
});

test('hook merge is idempotent and preserves unrelated handlers in our group', () => {
  const opts = { node: '/a path/node', script: '/repo/codex-hook.js', port: 8765 };
  const original = { description: 'mine', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo original' }] }] } };
  const one = mergeCodexHooks(original, opts);
  assert.equal(one.hooks.PermissionRequest, undefined);
  assert.deepEqual(mergeCodexHooks(one, opts), one);
  one.hooks.Stop.at(-1).hooks.push({ type: 'command', command: 'echo keep' });
  const removed = mergeCodexHooks(one, { ...opts, remove: true });
  assert.deepEqual(removed.hooks.Stop.flatMap((g) => g.hooks.map((h) => h.command)), ['echo original', 'echo keep']);
  assert.equal(original.hooks.Stop.length, 1);
  const legacy = { hooks: { PermissionRequest: [{ hooks: [
    { type: 'command', command: 'node codex-hook.js --kindle-dashboard', timeout: 600 },
    { type: 'command', command: 'echo keep-permission-hook' },
  ] }] } };
  const upgraded = mergeCodexHooks(legacy, opts);
  assert.deepEqual(upgraded.hooks.PermissionRequest, [{ hooks: [{ type: 'command', command: 'echo keep-permission-hook' }] }]);
});

function response() {
  const r = new EventEmitter(); r.writeHead = () => {}; r.end = (body) => { r.body = body; }; return r;
}
const payload = { session_id: 'test-codex-thread', tool_name: 'Bash', tool_input: { command: 'date' } };

function permissionFixture(t, reviewer) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-reviewer-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, 'sessions'));
  const file = path.join(home, 'sessions/rollout.jsonl');
  const hook = { ...payload, turn_id: 'permission-turn', transcript_path: file };
  fs.writeFileSync(file, [record('session_meta', { id: hook.session_id }),
    record('turn_context', { turn_id: hook.turn_id, approvals_reviewer: reviewer, approval_policy: 'on-request' })]
    .map(JSON.stringify).join('\n') + '\n');
  return { home, hook };
}

test('legacy permission hooks immediately yield to Codex for every reviewer, even with Kindle connected', (t) => {
  for (const reviewer of ['user', 'auto_review', undefined, 'future-reviewer']) {
    const { home, hook } = permissionFixture(t, reviewer);
    const events = [];
    const agent = createCodex({ home, shouldHold: () => true, onChange: (topic) => events.push(topic),
      rpc: { request: async () => ({ data: [] }), stop() {} } });
    t.after(() => agent.stop());
    const res = response(); agent.onHook('PermissionRequest', hook, res);
    assert.equal(res.body, '{}');
    assert.equal(agent.asks().length, 0);
    assert.equal(agent.status().pendingPermissions, 0);
    assert.equal(agent.detail(hook.session_id), null);
    assert.ok(!events.some((event) => event.endsWith('.permission.request')));
  }
});

test('adapter observes native approvals and keeps them on the host when Kindle disconnects', async (t) => {
  const events = new EventEmitter();
  const state = { id: 'chat', requests: [{ id: 42, method: 'item/commandExecution/requestApproval',
    params: { threadId: 'chat', turnId: 'turn', command: 'date' } }] };
  const sent = [];
  const agent = createCodex({ permissionControl: { async openThread() { return { state, events, close() {},
    async answerApproval(request, decision) { sent.push({ id: request.id, decision }); } }; } },
    rpc: { request: async () => ({ data: [] }), stop() {} } });
  t.after(() => agent.stop());
  agent.onHook('PreToolUse', { session_id: 'chat', tool_name: 'Bash' }, response());
  await new Promise((r) => setImmediate(r));
  assert.equal(agent.asks().length, 1);
  assert.equal(agent.detail('chat').pendingPermission, true);
  assert.equal(agent.releasePermissions('unlinked'), 0);
  assert.equal(agent.asks().length, 1); assert.equal(sent.length, 0);
  await agent.answerPermission(agent.asks()[0].id, 'allow');
  assert.deepEqual(sent, [{ id: 42, decision: 'accept' }]);
  state.requests = []; events.emit('state', state);
  assert.equal(agent.status().pendingPermissions, 0);
});

test('Codex questions are visible in Queue and resolved when the tool finishes', (t) => {
  const agent = createCodex({ rpc: { request: async () => ({ data: [] }), stop() {} } });
  t.after(() => agent.stop());
  agent.onHook('PreToolUse', { session_id: 'question-session', turn_id: 'q1', tool_name: 'request_user_input',
    tool_input: { questions: [{ header: 'Layout', question: 'Which screen?', options: [{ label: 'Portrait', description: 'Tall' }] }] } }, response());
  assert.equal(agent.asks()[0].kind, 'question');
  assert.equal(agent.asks()[0].questions[0].options[0].label, 'Portrait');
  agent.onHook('PostToolUse', { session_id: 'question-session', tool_name: 'request_user_input' }, response());
  assert.equal(agent.asks().length, 0);
});

test('Codex hooks are routed to the Codex backend and rejected from the USB peer', async () => {
  const { createHandler } = await import('../../src/http-server.js');
  const calls = [];
  const handler = createHandler({ onHook(event, payload, res, provider) {
    calls.push({ event, provider, id: payload.session_id }); res.writeHead(200); res.end('{}');
  } });
  for (const address of ['127.0.0.1', '192.168.2.2']) {
    const req = new EventEmitter(); Object.assign(req, { method: 'POST', url: '/codex/hook', socket: { remoteAddress: address } });
    const res = response(); res.writeHead = (status) => { res.status = status; };
    const done = handler(req, res);
    req.emit('data', Buffer.from(JSON.stringify({ hook_event_name: 'Stop', session_id: 's' }))); req.emit('end');
    await done;
    assert.equal(res.status, address === '127.0.0.1' ? 200 : 404);
  }
  assert.deepEqual(calls, [{ event: 'Stop', provider: 'codex', id: 's' }]);
});
