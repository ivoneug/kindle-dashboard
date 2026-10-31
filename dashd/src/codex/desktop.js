// Codex Desktop's local coordination socket. This is a versioned internal
// protocol (tested with 0.165.0-alpha.1.2), separate from app-server's socket.
// We register as a follower, never resume a thread or claim ownership of it.
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { CODEX_HOME } from './config.js';

const MAX_FRAME = 32 * 1024 * 1024;
const VERSIONS = { initialize: 0, 'thread-owner-discovery': 1, 'thread-follower-compact-thread': 1,
  'thread-follower-command-approval-decision': 1, 'thread-follower-file-approval-decision': 1 };
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);

export function applyDesktopPatches(state, patches) {
  for (const { op, path: parts, value } of patches) {
    if (!Array.isArray(parts) || parts.some((p) => unsafe.has(String(p))) || !['add', 'replace', 'remove'].includes(op)) throw new Error('Unsupported Codex state patch');
    if (!parts.length) { if (op === 'remove') throw new Error('Invalid Codex state'); state = value; continue; }
    let parent = state;
    for (const key of parts.slice(0, -1)) {
      if (!parent || !Object.hasOwn(parent, key)) throw new Error('Incomplete Codex state');
      parent = parent[key];
    }
    const key = parts.at(-1);
    if (!parent || typeof parent !== 'object') throw new Error('Invalid Codex state patch');
    if (Array.isArray(parent) && op !== 'replace' && key !== 'length') {
      if (!Number.isInteger(key) || key < 0 || key > parent.length) throw new Error('Invalid Codex array patch');
      parent.splice(key, op === 'remove' ? 1 : 0, ...(op === 'add' ? [value] : []));
    } else if (op === 'remove') delete parent[key];
    else parent[key] = value;
  }
  return state;
}

export function desktopTurns(state) {
  const history = state?.turnHistory;
  return [...(state?.turns || []), ...Object.values(history?.history?.entitiesByKey || {})]
    .filter((turn) => turn && (turn.turnId || turn.id) && Array.isArray(turn.items));
}

export function desktopIdle(state) {
  return state?.threadRuntimeStatus?.type === 'idle' && Array.isArray(state.requests) && state.requests.length === 0;
}

export function createDesktopControl({ home = CODEX_HOME, timeoutMs = 5000 } = {}) {
  return {
    async openThread(conversationId) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(conversationId)) throw new Error('Invalid Codex session ID');
      const pipe = path.join(home, 'ipc', 'ipc.sock');
      const uid = process.getuid?.();
      const dir = fs.lstatSync(path.dirname(pipe)), file = fs.lstatSync(pipe);
      if (!dir.isDirectory() || !file.isSocket() || uid == null || dir.uid !== uid || file.uid !== uid || (dir.mode & 0o022)) {
        throw new Error('Untrusted Codex desktop socket');
      }
      const events = new EventEmitter(), pending = new Map();
      const socket = net.createConnection(pipe);
      let clientId = 'initializing-client', owner = null, buffer = Buffer.alloc(0);
      let state = null, revision = null, ended = false;

      function write(message) {
        const data = Buffer.from(JSON.stringify(message)), frame = Buffer.alloc(4 + data.length);
        frame.writeUInt32LE(data.length); data.copy(frame, 4); socket.write(frame);
      }
      function following(value) {
        write({ type: 'broadcast', method: 'thread-stream-following-changed', sourceClientId: clientId,
          version: 1, targetClientIds: [owner], params: { hostId: 'local', conversationId, following: value } });
      }
      function fail(error) {
        if (ended) return;
        ended = true;
        for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Object.assign(new Error(error.message), { uncertain: p.written })); }
        pending.clear(); events.emit('disconnect', error); socket.destroy();
      }
      function request(method, params, targetClientId) {
        if (!Object.hasOwn(VERSIONS, method)) return Promise.reject(new Error('Unsupported desktop request'));
        if (ended) return Promise.reject(new Error('Codex desktop disconnected'));
        return new Promise((resolve, reject) => {
          const requestId = randomUUID();
          const timer = setTimeout(() => {
            const p = pending.get(requestId); pending.delete(requestId);
            reject(Object.assign(new Error('Codex desktop request timed out'), { uncertain: p?.written }));
          }, timeoutMs);
          const p = { resolve, reject, timer, written: false }; pending.set(requestId, p);
          try {
            write({ type: 'request', requestId, sourceClientId: clientId, version: VERSIONS[method], method, params, targetClientId, timeoutMs });
            p.written = true;
          } catch (e) { clearTimeout(timer); pending.delete(requestId); reject(e); }
        });
      }
      function handle(m) {
        if (m.type === 'client-discovery-request') {
          write({ type: 'client-discovery-response', requestId: m.requestId, response: { canHandle: false } });
        } else if (m.type === 'response') {
          const p = pending.get(m.requestId); if (!p) return;
          clearTimeout(p.timer); pending.delete(m.requestId);
          if (m.resultType === 'success') p.resolve(m);
          else p.reject(new Error(m.error || 'Codex desktop rejected request'));
        } else if (m.type === 'broadcast' && m.method === 'client-status-changed' && m.params?.clientId === owner && m.params.status === 'disconnected') {
          fail(new Error('Codex session owner disconnected'));
        } else if (m.type === 'broadcast' && m.method === 'thread-stream-state-changed' && m.sourceClientId === owner && m.params?.conversationId === conversationId) {
          if (m.version !== 11 || m.params.hostId !== 'local') throw new Error('Unsupported Codex desktop state version');
          const change = m.params.change;
          if (change.type === 'snapshot') state = change.conversationState;
          else if (change.type === 'patches' && state && revision === change.baseRevision) state = applyDesktopPatches(state, change.patches);
          else throw new Error('Codex desktop state out of sync');
          if (state?.id !== conversationId) throw new Error('Codex desktop session mismatch');
          revision = change.revision; events.emit('state', state);
        }
      }
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
          while (buffer.length >= 4) {
            const length = buffer.readUInt32LE(0);
            if (!length || length > MAX_FRAME) throw new Error('Invalid Codex desktop frame');
            if (buffer.length < length + 4) break;
            const message = JSON.parse(buffer.subarray(4, length + 4)); buffer = buffer.subarray(length + 4); handle(message);
          }
        } catch (e) { fail(e); }
      });
      socket.on('error', fail); socket.on('close', () => fail(new Error('Codex desktop disconnected')));
      const close = () => {
        if (ended) return;
        if (owner && socket.writable) following(false);
        events.removeAllListeners(); fail(new Error('Desktop observer closed'));
      };
      try {
        const init = await request('initialize', { clientType: 'kindle-dashboard' });
        clientId = init.result.clientId;
        owner = (await request('thread-owner-discovery', { hostId: 'local', conversationId })).handledByClientId;
        if (!owner) throw new Error('Codex session has no live owner');
        await new Promise((resolve, reject) => {
          const done = () => { clearTimeout(timer); events.off('state', got); events.off('disconnect', lost); };
          const got = () => { done(); resolve(); }, lost = (e) => { done(); reject(e); };
          const timer = setTimeout(() => { done(); reject(new Error('Codex desktop snapshot timed out')); }, timeoutMs);
          events.once('state', got); events.once('disconnect', lost); following(true);
        });
        return { get state() { return state; }, events, close,
          answerApproval: (approval, decision) => {
            const methods = { 'item/commandExecution/requestApproval': 'thread-follower-command-approval-decision',
              'item/fileChange/requestApproval': 'thread-follower-file-approval-decision' };
            const current = state?.requests?.find((r) => r.id === approval.id && r.method === approval.method);
            if (!Object.hasOwn(methods, approval.method) || !['accept', 'decline'].includes(decision) ||
                !current || current.completed === true || current.params?.threadId !== conversationId ||
                JSON.stringify(current) !== JSON.stringify(approval)) {
              return Promise.reject(new Error('Codex approval is no longer available'));
            }
            return request(methods[approval.method], { conversationId, requestId: approval.id, decision }, owner);
          },
          compact: () => request('thread-follower-compact-thread', { conversationId }, owner) };
      } catch (e) { close(); throw e; }
    },
  };
}
