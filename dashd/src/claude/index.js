// Claude Code side of dashd, in-process. Wires up what claude-thing's daemon
// index.js wired behind its WebSocket hub — sessions, permission bridge,
// question queue, usage, window focus — minus the hub: every event it would
// have broadcast lands in `state` here, and onChange tells dashd to redraw.

import { createStore } from './sessions/store.js';
import { createPermissionBridge } from './permission-bridge.js';
import { createSources } from './sessions/index.js';
import { createFocus } from './focus.js';
import { createQueue } from './queue.js';
import { createUsage } from './usage.js';
import { MOCK_SESSIONS } from './config.js';
import { log } from './log.js';

// shouldHold(): whether a permission request should wait for the Kindle (see
// permission-bridge.js).
export function createClaude({ onChange = () => {}, shouldHold } = {}) {
  const state = {
    sessions: [],        // SessionSummary[], newest snapshot (docs/claude-protocol.md)
    stats: { active: 0, attention: 0 },
    serverNowMs: 0,
    details: {},         // id -> SessionDetail
    usage: null,
  };

  function emit(topic, data) {
    switch (topic) {
      case 'claude.sessions.update':
        state.sessions = data.sessions;
        state.stats = data.stats;
        state.serverNowMs = data.serverNowMs;
        break;
      case 'claude.session.update':
        if (data.ended) delete state.details[data.id];
        else state.details[data.id] = data;
        break;
      case 'claude.usage.update':
        state.usage = data;
        break;
    }
    onChange(topic, data);
  }

  const store = createStore();
  const focus = createFocus();
  const queue = createQueue({ emit, store, focus });
  const permissionBridge = createPermissionBridge({ emit, store, queue, shouldHold });
  const usage = createUsage({ emit });
  const sources = createSources({ store, permissionBridge, queue });

  store.onSnapshot = (snap) => emit('claude.sessions.update', snap);
  store.onDetail = (detail) => emit('claude.session.update', detail);
  usage.start();
  log('--', `claude: ${MOCK_SESSIONS ? 'MOCK sessions' : 'real sources'}`);

  return {
    state,
    // Everything waiting on a human, oldest first: permissions and questions.
    asks: () => [...permissionBridge.list(), ...queue.list()].sort((a, b) => a.createdTs - b.createdTs),

    // A hook POST from Claude Code. PermissionRequest keeps `res` open until
    // it is answered; everything else is acknowledged at once.
    onHook(event, payload, res) {
      if (event === 'PermissionRequest') return permissionBridge.onHookRequest(payload, res);
      sources.onHookEvent(event, payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    },

    // The freshest SessionDetail for one session, null once it is gone.
    detail: (id) => store.get(id),
    answerPermission: (requestId, decision) => permissionBridge.answer(requestId, decision),
    releasePermissions: (resolution) => permissionBridge.releaseAll(resolution),
    answerQuestion: (id, answers) => queue.answerQuestion(id, answers),
    // Through the same lock as answering a question (see focus.js).
    focusSession: (id) => focus.exclusive(() => focus.focusSession(id)),

    status: () => ({
      sessions: store.count(),
      pendingPermissions: permissionBridge.pendingCount(),
      questions: queue.size(),
      sources: sources.status(),
      hooks: sources.hooksInstalled(),
    }),

    stop() {
      usage.stop();
      sources.stop();
    },
  };
}
