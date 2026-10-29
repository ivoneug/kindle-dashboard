// Labels and formatting shared by the screens, after claude-thing's
// device-app/src/screens/helpers.js.

export function fmtDuration(ms) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return mins + 'm';
  return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
}

export function stateLabel(state, ended) {
  if (state === 'idle') return ended ? 'ENDED' : 'IDLE';
  return { busy: 'WORKING', attention: 'ATTENTION', celebrate: 'DONE' }[state] || 'IDLE';
}

// Permission mode as the tile chip names it; anything unrecognized — including
// no mode reported yet — draws no chip rather than a guess.
const MODE_LABELS = {
  plan: 'PLAN',
  bypassPermissions: 'BYPASS',
  acceptEdits: 'EDITS',
  auto: 'AUTO',
  default: 'MANUAL',
  'on-request': 'ON REQUEST',
  'on-failure': 'ON FAILURE',
  never: 'NO PROMPTS',
  untrusted: 'UNTRUSTED',
};

export function modeLabel(mode) {
  return MODE_LABELS[mode] || null;
}

const EFFORT_LABELS = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  xhigh: 'XHIGH',
  max: 'MAX',
  ultrathink: 'ULTRA',
};

export function effortLabel(effort) {
  return EFFORT_LABELS[effort] || null;
}

export function compactLabel(job, now = Date.now()) {
  if (!job || (job.finishedTs && now - job.finishedTs > 60_000)) return '';
  return { queued: 'COMPACT QUEUED',
    running: 'COMPACTING', unknown: 'COMPACT STATUS UNKNOWN · CHECK CODEX',
    done: 'COMPACT DONE', failed: 'COMPACT FAILED' }[job.status] || '';
}
