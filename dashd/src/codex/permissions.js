// Observe approvals after Codex has routed them to its normal UI. Holding a
// PermissionRequest hook hides the request from both the app and its reviewer.
import { randomUUID } from 'node:crypto';
import { DESTRUCTIVE_RE } from '../claude/permission-bridge.js';
import { desktopTurns } from './desktop.js';

function describe(request, state) {
  const p = request.params;
  if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(request.method) ||
      request.completed === true || !p || p.threadId !== state.id || typeof p.turnId !== 'string' || !p.turnId ||
      !(typeof request.id === 'string' || Number.isSafeInteger(request.id))) return null;
  // Never substitute a session-wide grant or another future decision for Y/N.
  if (p.availableDecisions != null && (!Array.isArray(p.availableDecisions) ||
      !['accept', 'decline'].every((d) => p.availableDecisions.includes(d)))) return null;
  const item = desktopTurns(state).find((t) => (t.turnId || t.id) === p.turnId)?.items
    .find((i) => i.id === p.itemId);
  if (request.method === 'item/commandExecution/requestApproval') {
    const command = p.command || (item?.type === 'commandExecution' && item.command);
    if (typeof command !== 'string' || !command.trim()) return null;
    return { tool: 'Bash', summary: command.slice(0, 200), destructive: DESTRUCTIVE_RE.test(command) };
  }
  const changes = item?.type === 'fileChange' && Array.isArray(item.changes) ? item.changes : [];
  if (!changes.length || changes.some((c) => typeof c.path !== 'string' || !c.path)) return null;
  return { tool: 'apply_patch', summary: changes.map((c) => c.path).join('\n').slice(0, 200),
    destructive: changes.some((c) => c.kind?.type === 'delete') };
}

export function createDesktopPermissions({ control, store, emit }) {
  const sessions = new Map();
  let stopped = false;

  function sync(id, entry) {
    const state = entry.watch.state;
    const previous = entry.asks;
    const next = new Map();
    for (const request of state.requests || []) {
      const details = describe(request, state);
      if (!details) continue;
      const key = JSON.stringify([request.id, request.method, request.params, details]);
      const old = previous.get(key);
      next.set(key, old || { id: randomUUID(), request: structuredClone(request), key, ...details, createdTs: Date.now() });
    }
    entry.asks = next;
    updateStore(id, entry);
    for (const [key, ask] of previous) if (!next.has(key)) emit('codex.permission.resolved', { requestId: ask.id });
    for (const [key, ask] of next) if (!previous.has(key)) emit('codex.permission.request', { requestId: ask.id, sessionId: id });
  }

  function updateStore(id, entry) {
    const session = store.get(id);
    if (!session) return;
    // Back only dismisses the Kindle card; the chat still needs a human reply.
    const ask = entry.asks.values().next().value;
    if (session.pendingPermission === !!ask && session.permission?.requestId === ask?.id) return;
    store.upsert(id, { pendingPermission: !!ask, permission: ask ? {
      requestId: ask.id, tool: ask.tool, summary: ask.summary, createdTs: ask.createdTs,
      destructive: ask.destructive,
    } : null });
  }

  function unwatch(id) {
    const entry = sessions.get(id);
    if (!entry) return;
    sessions.delete(id);
    entry.watch?.events.off('state', entry.changed);
    entry.watch?.events.off('disconnect', entry.lost);
    entry.watch?.close();
    const asks = [...entry.asks.values()];
    entry.asks.clear(); updateStore(id, entry);
    for (const ask of asks) emit('codex.permission.resolved', { requestId: ask.id });
  }

  async function watch(id) {
    if (stopped || sessions.has(id)) return;
    const entry = { asks: new Map(), watch: null };
    sessions.set(id, entry);
    try {
      const observer = await control.openThread(id);
      if (stopped || sessions.get(id) !== entry) { observer.close(); return; }
      entry.watch = observer;
      entry.changed = () => sync(id, entry);
      entry.lost = () => unwatch(id);
      observer.events.on('state', entry.changed);
      observer.events.on('disconnect', entry.lost);
      sync(id, entry);
    } catch { if (sessions.get(id) === entry) unwatch(id); }
    // No live desktop owner or unfamiliar protocol: leave the host in charge.
    // A later metadata poll retries observation, never an approval decision.
  }

  function list() {
    return [...sessions].flatMap(([id, entry]) => [...entry.asks.values()]
      .filter((a) => !a.dismissed && !a.submitting)
      .map((a) => ({ kind: 'permission', id: a.id, sessionId: id,
        sessionName: store.get(id)?.name || 'Codex session', tool: a.tool, summary: a.summary,
        intent: a.request.params.reason || '', createdTs: a.createdTs, destructive: a.destructive })));
  }

  async function answer(id, decision) {
    if (!['allow', 'deny', 'ask'].includes(decision)) throw new Error('decision must be allow|deny|ask');
    for (const [sessionId, entry] of sessions) {
      const ask = [...entry.asks.values()].find((a) => a.id === id);
      if (!ask || ask.dismissed || ask.submitting) continue;
      // Check the latest snapshot too, not merely the card the Kindle saw.
      sync(sessionId, entry);
      if (entry.asks.get(ask.key) !== ask) return false;
      if (decision === 'ask') {
        ask.dismissed = true;
        emit('codex.permission.resolved', { requestId: id });
        return true;
      }
      ask.submitting = true;
      try {
        await entry.watch.answerApproval(ask.request, decision === 'allow' ? 'accept' : 'decline');
        return true;
      } finally {
        // A timeout may follow a successful send. Never retry automatically or
        // accept a repeated key; the original request remains available on Mac.
        emit('codex.permission.resolved', { requestId: id });
      }
    }
    return false;
  }

  return { watch, unwatch, list, answer,
    pendingCount: () => [...sessions.values()].reduce((n, e) => n + e.asks.size, 0),
    stop() { stopped = true; for (const id of [...sessions.keys()]) unwatch(id); } };
}
