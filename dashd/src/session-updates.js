import { createHash } from 'node:crypto';

// Compare tile content, not poll timestamps or the quiet/finished age counter.
export function createSessionUpdates() {
  let signature = null, revision = 0, seen = 0, active = false;
  return {
    update(sessions, details = {}, compactions = {}) {
      active = sessions.some((s) => s.state === 'busy' || s.state === 'attention');
      const next = createHash('sha256').update(JSON.stringify(sessions.map((s) => {
        const d = details[s.id] || {};
        return [s.id, s.name, s.state, s.ended, !!s.pendingPermission, s.model, s.effort, s.permissionMode, s.context,
          d.activity || '', d.currentTool || '', d.lastMessage || '', compactions[s.id]?.status || ''];
      }))).digest('hex');
      if (next !== signature) { signature = next; revision++; }
      if (revision === 1) seen = revision;
    },
    acknowledge(value) {
      const wasPending = active && revision > seen;
      if (Number.isSafeInteger(value) && value > seen && value <= revision) seen = value;
      return wasPending !== (active && revision > seen);
    },
    get pending() { return active && revision > seen; },
    get revision() { return revision; },
  };
}
