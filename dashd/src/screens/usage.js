// Usage: the real /usage figures as gauges, after claude-thing's usage screen.
// Each limit is its own bar with its own mascot and verdict, so being out of
// one says nothing about the others. Thresholds are the design's: under 80%
// ALL CLEAR, 80–99% RUNNING OUT, 100% OUT OF USAGE — and out of usage is the
// one that needs a person, so it alone is inverted.

import { esc, topbar, legend, page } from './page.js';
import { sprite } from './sprites.js';

const CSS = `
.usage { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 16px; padding: 18px 18px 10px; }
.landscape .usage { gap: 12px; padding-top: 14px; }

.ubar { display: flex; align-items: flex-end; gap: 14px; }
.ubarmain { flex: 1; min-width: 0; }
.uhead { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; }
.ulabel { font-weight: 700; font-size: 19px; letter-spacing: 0.14em; white-space: nowrap; }
.ureset { flex: 1; min-width: 0; font-family: var(--mono); font-size: 14px; color: var(--ink-3);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.upct { font-family: var(--mono); font-size: 26px; }
.utrack { position: relative; height: 26px; border: 2px solid var(--ink); background: var(--paper); }
.mood-low .utrack { border-width: 4px; }
.ufill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--ink); }
.mood-low .ufill { background: repeating-linear-gradient(-45deg, var(--ink) 0 8px, #555 8px 12px); }
.uphrase { margin-top: 6px; font-weight: 700; font-size: 14px; letter-spacing: 0.16em; }
.mood-out .uphrase { display: inline-block; padding: 0 8px; background: var(--ink); color: var(--paper); line-height: 24px; }
.ubar .usprite { flex-shrink: 0; }

.ubreak { margin-top: 4px; padding-top: 12px; border-top: var(--rule); }
.uwin { font-family: var(--mono); font-size: 15px; margin-bottom: 10px; }
.utables { display: flex; gap: 24px; }
.utable { flex: 1; min-width: 0; }
.uthead { font-weight: 700; font-size: 14px; letter-spacing: 0.16em; margin-bottom: 4px; }
.utrow { display: flex; gap: 8px; font-family: var(--mono); font-size: 15px; line-height: 1.5; }
.utname { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.empty { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center;
  padding: 0 40px; font-weight: 700; font-size: 22px; letter-spacing: 0.16em; line-height: 1.5; }
`;

function mood(pct) {
  if (pct >= 1) return 'out';
  if (pct >= 0.8) return 'low';
  return 'clear';
}

const PHRASE = { clear: 'ALL CLEAR', low: 'RUNNING OUT', out: 'OUT OF USAGE' };
const SPRITE = { clear: 'usage-calm', low: 'usage-sweat', out: 'usage-asleep' };

function bar(l) {
  const pct = Math.max(0, Math.min(1, l.used || 0));
  const m = mood(pct);
  return '<div class="ubar mood-' + m + '">' +
    '<div class="ubarmain">' +
    '<div class="uhead"><span class="ulabel">' + esc(String(l.label || '').toUpperCase()) + '</span>' +
    '<span class="ureset">' + esc(l.detail || '') + '</span>' +
    '<span class="upct">' + Math.round(pct * 100) + '%</span></div>' +
    '<div class="utrack"><span class="ufill" style="width:' + (pct * 100).toFixed(1) + '%"></span></div>' +
    '<div class="uphrase">' + PHRASE[m] + '</div>' +
    '</div>' +
    sprite(SPRITE[m], { size: 64, className: 'usprite' }) +
    '</div>';
}

function table(title, rows) {
  const body = rows.slice(0, 3).map((r) =>
    '<div class="utrow"><span class="utname">' + esc(r.name) + '</span><span>' + esc(r.pct) + '</span></div>'
  ).join('') || '<div class="utrow"><span class="utname">—</span></div>';
  return '<div class="utable"><div class="uthead">' + title + '</div>' + body + '</div>';
}

// What the window was, then who used it.
function breakdown(u) {
  const w = (u.windows || [])[0];
  if (!w) return '';
  return '<div class="ubreak">' +
    '<div class="uwin">' + esc(w.window) + ' · ' + w.requests + ' requests · ' + w.sessions + ' sessions</div>' +
    '<div class="utables">' + table('SKILLS', w.skills || []) + table('SUBAGENTS', w.subagents || []) + '</div>' +
    '</div>';
}

// view: { usage, linked, waiting, orientation, note }
export function renderUsage(view, { width, height }) {
  const u = view.usage;
  let body;
  if (!u || !u.limits || !u.limits.length) {
    body = '<div class="empty">' + esc(u && u.error ? String(u.error).toUpperCase() : 'READING USAGE…') + '</div>';
  } else {
    body = '<div class="usage">' + u.limits.map(bar).join('') + breakdown(u) + '</div>';
  }
  const meta = view.note || (u ? (u.updatedLabel || '') + (u.stale ? ' · stale' : '') : '');
  const html = '<div class="screen">' +
    topbar('USAGE', { linked: view.linked, waiting: view.waiting }) +
    body +
    legend([['S', 'sessions']], meta) +
    '</div>';
  return page(html, { width, height, orientation: view.orientation, extraCss: CSS });
}
