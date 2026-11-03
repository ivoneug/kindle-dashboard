// Usage: the real /usage figures as gauges, after claude-thing's usage screen.
// Each limit is its own bar with its own mascot and verdict, so being out of
// one says nothing about the others. Thresholds are the design's: under 80%
// ALL CLEAR, 80–99% RUNNING OUT, 100% OUT OF USAGE — and out of usage is the
// one that needs a person, so it alone is inverted.

import { esc, topbar, legend, page } from './page.js';
import { mascot } from './mascots.js';

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

.uresets { margin-top: 4px; padding-top: 12px; border-top: var(--rule); }
.uresets-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px;
  font-size: 15px; font-weight: 700; letter-spacing: 0.12em; }
.uresets-count { font-family: var(--mono); letter-spacing: 0; white-space: nowrap; }
.ureset-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.landscape .ureset-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.ureset-card { padding: 12px; border: var(--rule); display: flex; flex-direction: column; gap: 8px; }
.ureset-title { font-size: 20px; font-weight: 700; overflow-wrap: anywhere; }
.ureset-description { font-size: 14px; line-height: 1.3; overflow-wrap: anywhere; }
.ureset-expiry, .uresets-more { font-family: var(--mono); font-size: 14px; line-height: 1.4; color: var(--ink-3); }
.ureset-expiry { margin-top: auto; padding-top: 4px; font-weight: 700; }
.uresets-more { margin-top: 10px; }

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

function bar(l, provider) {
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
    mascot(provider, SPRITE[m], { size: 64, className: 'usprite' }) +
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

function resetCards(resets, now) {
  if (!resets || !resets.availableCount) return '';
  const rows = resets.credits || [];
  const credits = rows.filter((c) => c.expiresTs == null || c.expiresTs > now);
  const count = Math.max(0, resets.availableCount - (rows.length - credits.length));
  if (!count) return '';
  const cards = credits.map((c) => {
    const expiry = c.expiresTs == null ? 'No expiry' : 'Expires ' + new Date(c.expiresTs).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    return '<div class="ureset-card"><div class="ureset-title">' + esc(c.title) + '</div>' +
      (c.description ? '<div class="ureset-description">' + esc(c.description) + '</div>' : '') +
      '<div class="ureset-expiry">' + esc(expiry) + '</div></div>';
  }).join('');
  const more = count - credits.length;
  return '<section class="uresets"><div class="uresets-head"><span>USAGE LIMIT RESETS</span>' +
    '<span class="uresets-count">' + count + ' available</span></div>' +
    (cards ? '<div class="ureset-cards">' + cards + '</div>' : '') +
    (more > 0 ? '<div class="uresets-more">' + (credits.length ? '+' + more + ' more available' : 'Available to use in Codex') + '</div>' : '') +
    '</section>';
}

// view: { usage, linked, waiting, orientation, note, battery, now }
export function renderUsage(view, { width, height }) {
  const u = view.usage;
  const resets = resetCards(u?.resetCredits, view.now ?? Date.now());
  let body;
  if ((!u || !u.limits || !u.limits.length) && !resets) {
    body = '<div class="empty">' + esc(u && u.error ? String(u.error).toUpperCase() : 'READING USAGE…') + '</div>';
  } else {
    body = '<div class="usage">' + (u.limits || []).map((l) => bar(l, view.provider || u.provider)).join('') + resets + breakdown(u) + '</div>';
  }
  const meta = view.note || (u ? (u.updatedLabel || '') + (u.stale ? ' · stale' : '') : '');
  const html = '<div class="screen">' +
    topbar('USAGE', { linked: view.linked, waiting: view.waiting, battery: view.battery ?? null }) +
    body +
    legend([['S', 'sessions']], meta) +
    '</div>';
  return page(html, { width, height, orientation: view.orientation, extraCss: CSS });
}
