// Sessions: claude-thing's session grid in e-ink. Portrait stacks four tiles
// in one column, landscape lays them out 2×2 like the Car Thing; more than
// four pages, and the page follows the selection.
//
// Colour → form (kindle-dashboard.md §7.1): the ATTENTION tile is inverted,
// lamps differ by shape (busy filled, done ticked, idle hollow), the selected
// tile gets the heavy frame, and nothing animates.

import { esc, topbar, legend, contextMeter, page } from './page.js';
import { stateLabel, modeLabel, effortLabel, fmtDuration } from './helpers.js';
import { frameFor } from './sprites.js';
import { mascot } from './mascots.js';
import { renderMarkdownPreview } from './markdown.js';

export const PER_PAGE = 4;

const CSS = `
.grid { flex: 1; min-height: 0; display: grid; gap: 10px; padding: 12px 18px; }
.portrait .grid { grid-template-rows: repeat(4, 1fr); }
.landscape .grid { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }

.tile { position: relative; display: flex; flex-direction: column; min-height: 0; overflow: hidden;
  padding: 10px 14px 10px 14px; border: 2px solid var(--ink); border-radius: 8px; background: var(--paper); }
.tile.selected { border-width: 5px; padding: 7px 11px; }
.tile.state-attention { background: var(--ink); color: var(--paper); }
.tile.state-idle .tname, .tile.state-idle .tsub { color: var(--muted); }

.thead { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.slabel { font-weight: 700; font-size: 17px; letter-spacing: 0.16em; }
.mode { margin-left: auto; padding: 0 7px; border: 2px solid currentColor; border-radius: 5px;
  font-weight: 700; font-size: 14px; letter-spacing: 0.14em; line-height: 22px; }
.mode.m-bypass { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.state-attention .mode.m-bypass { background: var(--paper); color: var(--ink); border-color: var(--paper); }
.badge { width: 26px; height: 26px; border-radius: 5px; background: var(--paper); color: var(--ink);
  font-weight: 700; font-size: 20px; line-height: 26px; text-align: center; }
.mode + .badge { margin-left: 0; }
.thead > .badge:nth-child(3) { margin-left: auto; }

.tname { margin-top: 2px; font-weight: 700; font-size: 28px; line-height: 1.2;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 4px; }
.landscape .tname { font-size: 32px; margin-top: 6px; }
.tsub { font-family: var(--mono); font-size: 16px; line-height: 1.3;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.landscape .tsub { font-size: 17px; margin-top: 4px; white-space: normal;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.tmessage { font-family: "Helvetica Neue", Arial, sans-serif; font-weight: 400; }
.tmessage strong { font-weight: 700; }
.tmessage code { font-family: var(--mono); font-size: 0.85em; background: var(--wash); padding: 0 3px; }
.state-attention .tmessage code { background: var(--ink-3); }

.tfoot { margin-top: auto; padding-right: 76px; }
.tspec { margin-bottom: 4px; font-family: var(--mono); font-size: 14px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile .ctxtrack { height: 22px; }
.tile .ctxtext { font-size: 13px; }
.state-attention .ctxtrack { border-color: var(--paper); background: var(--ink); }
.state-attention .ctxtrack > .ctxtext { color: var(--paper); }
.state-attention .ctxfill { background: var(--paper); }
.state-attention .ctxfill .ctxtext { color: var(--ink); }

.tile .sprite { position: absolute; right: 10px; bottom: 8px; }
.tile .codex-mascot { bottom: 0; }

.empty { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center;
  padding: 0 40px; font-weight: 700; font-size: 22px; letter-spacing: 0.16em; line-height: 1.5; }
`;

// What the tile's second line says, after claude-thing's subline(): the ask
// first, then what it is doing, then how long ago it finished.
function subline(s, d, now) {
  if (s.pendingPermission) return 'needs your answer';
  // What the Claude app shows under its task list: the running call's own words.
  if (d && d.activity) return '▶ ' + esc(d.activity);
  const message = d && d.lastMessage
    ? '<span class="tmessage">' + renderMarkdownPreview(d.lastMessage) + '</span>' : '';
  if (d && d.currentTool) return esc(d.currentTool) + (message ? ' · ' + message : '');
  if (s.state === 'celebrate' && s.lastActivityTs) return 'finished ' + fmtDuration(now - s.lastActivityTs) + ' ago';
  if (message) return message;
  return s.state === 'busy' ? 'working…' : '';
}

// Which strip the mascot comes from: the busy one picks its gait from effort,
// as on the Car Thing.
function spriteName(s) {
  if (s.state === 'attention') return 'attention';
  if (s.state === 'celebrate') return 'celebrate';
  if (s.state === 'busy') {
    const e = effortLabel(s.effort);
    if (e === 'XHIGH') return 'run-sweat';
    if (e === 'MAX' || e === 'ULTRA') return 'run-sweat-heavy';
    if (e) return 'dance-walk';
    return 'working';
  }
  return 'sleeping-idle';
}

function tile(s, d, selected, now, provider) {
  const mode = modeLabel(s.permissionMode);
  const model = (s.model || '').replace(/^claude-/, '');
  const eff = s.state === 'busy' ? effortLabel(s.effort) : null;
  const spec = [model, eff && eff.toLowerCase()].filter(Boolean).join(' · ');
  const attention = s.state === 'attention';
  const lamp = s.state === 'idle' && s.ended ? 'ended' : s.state;
  return '<div class="tile state-' + s.state + (selected ? ' selected' : '') + '">' +
    '<div class="thead"><span class="lamp ' + lamp + '"></span>' +
    '<span class="slabel">' + stateLabel(s.state, s.ended) + '</span>' +
    (mode ? '<span class="mode m-' + mode.toLowerCase() + '">' + mode + '</span>' : '') +
    (s.pendingPermission ? '<span class="badge">!</span>' : '') +
    '</div>' +
    '<div class="tname">' + esc(s.name) + '</div>' +
    '<div class="tsub">' + subline(s, d, now) + '</div>' +
    '<div class="tfoot">' +
    (spec ? '<div class="tspec">' + esc(spec) + '</div>' : '') +
    (s.context != null ? contextMeter(s.context) : '') +
    '</div>' +
    mascot(provider, spriteName(s), { frame: frameFor(s.id), size: 64, inverted: attention, muted: s.state === 'idle',
      className: provider === 'codex' ? 'sprite codex-mascot' : 'sprite' }) +
    '</div>';
}

// view: { sessions, details, selected, linked, waiting, orientation, note }
export function renderSessions(view, { width, height }) {
  const n = view.sessions.length;
  const pages = Math.max(1, Math.ceil(n / PER_PAGE));
  const pageNo = Math.floor(view.selected / PER_PAGE);
  const first = pageNo * PER_PAGE;
  const now = Date.now();

  let body;
  if (!n) {
    body = '<div class="empty">NO SESSIONS — START ' + esc((view.provider || 'claude').toUpperCase()) + ' ON YOUR MAC</div>';
  } else {
    body = '<div class="grid">' +
      view.sessions.slice(first, first + PER_PAGE)
        .map((s, i) => tile(s, view.details[s.id], first + i === view.selected, now, view.provider)).join('') +
      '</div>';
  }

  const provider = view.provider ? view.provider.toUpperCase() : '';
  const meta = view.note || [provider, pages > 1 ? 'PAGE ' + (pageNo + 1) + '/' + pages : ''].filter(Boolean).join(' · ');
  const html = '<div class="screen">' +
    topbar('SESSIONS', { count: n ? String(n) : '', linked: view.linked, waiting: view.waiting }) +
    body +
    legend([['↑↓', 'select'], ['●', 'open'], ['U', 'usage']], meta) +
    '</div>';
  return page(html, { width, height, orientation: view.orientation, extraCss: CSS });
}
