// Session detail, after claude-thing's session-detail screen: who and where,
// what it is doing right now, context and tokens, then its task list and the
// last message in full — paged, not scrolled, because e-ink redraws a page
// cleanly and a scroll badly.
//
// The message is laid out in CSS columns one box wide, so each column is a
// page; window.__layout() (called by the renderer once fonts are in) counts
// them, shows the asked-for page and reports {pages, page} back to dashd, so
// the page keys know where the end is.

import { esc, topbar, legend, contextMeter, page } from './page.js';
import { stateLabel, modeLabel, effortLabel, fmtDuration, compactLabel } from './helpers.js';
import { renderMarkdown } from './markdown.js';

const GAP = 40;

const CSS = `
.detail { flex: 1; min-height: 0; display: grid; gap: 14px; padding: 16px 18px 12px; }
.portrait .detail { grid-template-rows: auto minmax(0, 1fr); }
.landscape .detail { grid-template-columns: 330px minmax(0, 1fr); }
.info { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

.dhead { display: flex; align-items: center; gap: 10px; }
.slabel { font-weight: 700; font-size: 17px; letter-spacing: 0.16em; }
.head-actions { margin-left: auto; min-width: 0; display: flex; align-items: center; gap: 8px; }
.mode { flex: none; padding: 0 7px; border: 2px solid var(--ink); border-radius: 5px;
  font-weight: 700; font-size: 14px; letter-spacing: 0.14em; line-height: 22px; }
.mode.m-bypass { background: var(--ink); color: var(--paper); }
.dhead .slabel { flex: none; }
.landscape .dhead.has-compact-status { gap: 4px; }
.landscape .dhead.has-compact-status .slabel { font-size: 14px; letter-spacing: 0; }
.landscape .dhead.has-compact-status .head-actions { gap: 6px; }
.landscape .dhead.has-compact-status .mode { padding: 0 4px; letter-spacing: .03em; }

.dname { font-weight: 700; font-size: 32px; line-height: 1.15; overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.dmeta { font-family: var(--mono); font-size: 15px; color: var(--ink-3);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.activity { display: flex; gap: 12px; align-items: flex-start; font-family: var(--mono); font-size: 17px; line-height: 1.3; }
.activity .t { flex: 1; min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.activity .e { flex-shrink: 0; }
.activity.ask { display: inline-block; align-self: flex-start; padding: 0 8px; background: var(--ink); color: var(--paper);
  font-family: var(--sans); font-weight: 700; letter-spacing: 0.12em; line-height: 28px; }
.compact-status { min-width: 0; font: 700 14px var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.detail-screen .legend .item { white-space: nowrap; }
.portrait .detail-screen.has-compact .legend { gap: 10px; font-size: 15px; letter-spacing: .03em; }
.portrait .detail-screen.has-compact .legend .item { gap: 6px; }
.portrait .detail-screen.has-compact .legend .key { min-width: 28px; height: 28px; padding: 0 5px; font-size: 14px; }

.info .ctxtrack { height: 28px; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); border: var(--rule); }
.stat { padding: 6px 10px; }
.stat + .stat { border-left: var(--rule); }
.stat .v { font-family: var(--mono); font-size: 22px; }
.stat .k { font-weight: 700; font-size: 12px; letter-spacing: 0.14em; color: var(--ink-2); }

.msg { display: flex; flex-direction: column; min-height: 0; min-width: 0; border-top: var(--rule); padding-top: 10px; }
.landscape .msg { border-top: 0; border-left: var(--rule); padding: 0 0 0 16px; }
.msghead { display: flex; align-items: baseline; margin-bottom: 8px; }
.msghead .label { flex: 1; }
.msghead .pg { font-family: var(--mono); font-size: 15px; }
.msgbox { flex: 1; min-height: 0; overflow: hidden; }
/* Prose in one face: Chakra Petch is Latin-only here, and a paragraph that
   switches face at every English word reads as noise. */
.msgcols { height: 100%; column-gap: ${GAP}px; column-fill: auto;
  font-family: "Helvetica Neue", Arial, sans-serif; font-weight: 400;
  font-size: 18px; line-height: 1.42; overflow-wrap: anywhere; }
.msgcols.none { color: var(--muted); }
.msgcols .sec { font-family: var(--sans); font-weight: 700; font-size: 14px; letter-spacing: 0.16em; margin: 0 0 6px; }
.msgcols .sec + .plan { margin-top: 0; }
.msgcols .plan { list-style: none; padding: 0; margin: 0 0 16px; font-size: 17px; }
.msgcols .plan li { display: flex; gap: 10px; margin: 4px 0; }
.msgcols .plan .m { flex-shrink: 0; width: 18px; text-align: center; }
.msgcols .plan .completed { color: var(--muted); }
.msgcols .plan .in_progress { font-weight: 700; }
/* The Markdown of a reply, in e-ink terms: square bullets, code on a light
   wash or behind a heavy rule, nothing thinner than 2px. */
.msgcols > :first-child { margin-top: 0; }
.msgcols p { margin: 0 0 10px; }
.msgcols ul, .msgcols ol { margin: 0 0 10px; padding-left: 26px; }
.msgcols ul { list-style: square; }
.msgcols li { margin: 3px 0; }
.msgcols li > ul, .msgcols li > ol { margin: 3px 0 4px; }
.msgcols li > p { margin: 0; }
.msgcols h1, .msgcols h2, .msgcols h3, .msgcols h4 { font-weight: 700; font-size: 19px; margin: 14px 0 6px; }
.msgcols strong { font-weight: 700; }
.msgcols code { font-family: var(--mono); font-size: 15px; background: var(--wash); padding: 0 3px; }
.msgcols pre { margin: 0 0 10px; padding: 4px 0 4px 10px; border-left: 4px solid var(--ink);
  font-size: 14px; line-height: 1.35; white-space: pre-wrap; }
.msgcols pre code { background: none; padding: 0; font-size: inherit; }
.msgcols blockquote { margin: 0 0 10px; padding-left: 10px; border-left: 3px solid var(--muted); color: var(--ink-3); }
.msgcols table { border-collapse: collapse; margin: 0 0 10px; font-size: 15px; }
.msgcols th, .msgcols td { border: 2px solid var(--ink); padding: 2px 6px; text-align: left; vertical-align: top; }
.msgcols hr { border: 0; border-top: 2px solid var(--ink); margin: 10px 0; }
/* Keep a table, a code block or a list item on one page where it fits. */
.msgcols table, .msgcols pre, .msgcols li { break-inside: avoid; }
.msgcols h1, .msgcols h2, .msgcols h3, .msgcols h4 { break-after: avoid; }
/* A bold line on its own is how Claude writes a subheading: keep it with what
   follows instead of stranding it at the foot of a page. */
.msgcols p:has(> strong:only-child) { break-after: avoid; }
`;

function fmtTokens(n) {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

// Minutes only: a seconds counter would change every frame, and every frame
// costs the Kindle a redraw.
function since(ts, now) {
  return ts && now - ts >= 60_000 ? fmtDuration(now - ts) : '';
}

function activity(d, now) {
  if (d.pendingPermission) return '<div class="activity ask">NEEDS YOUR ANSWER</div>';
  // The running call, as the Claude app words it under its task list; how long
  // it has run sits apart so a long description cannot push it off.
  if (d.activity) {
    return '<div class="activity"><span class="t">▶ ' + esc(d.activity) + '</span>' +
      '<span class="e">' + since(d.activityTs, now) + '</span></div>';
  }
  let text;
  if (d.currentTool) text = d.currentTool + ' — working';
  else if (d.state === 'celebrate' && d.lastActivityTs) text = 'finished ' + fmtDuration(now - d.lastActivityTs) + ' ago';
  else if (d.state === 'busy') text = 'thinking…';
  else if (d.lastActivityTs) text = 'quiet for ' + fmtDuration(now - d.lastActivityTs);
  else text = 'no active tool';
  return '<div class="activity">' + esc(text) + '</div>';
}

// Runs in the page. Each column is one page wide, so the column count is the
// page count; the shown page slides into the box.
const LAYOUT = `
window.__layout = function () {
  var el = document.getElementById('msg');
  if (!el) return null;
  var box = el.parentElement;
  var step = box.clientWidth + ${GAP};
  el.style.columnWidth = box.clientWidth + 'px';
  var pages = Math.max(1, Math.round((el.scrollWidth + ${GAP}) / step));
  var want = Number(el.dataset.page) || 0;
  var p = Math.max(0, Math.min(pages - 1, want));
  el.style.transform = 'translateX(' + (-p * step) + 'px)';
  document.getElementById('pg').textContent = pages > 1 ? (p + 1) + '/' + pages : '';
  return { pages: pages, page: p };
};`;

// view: { session: SessionDetail, index, total, msgPage, linked, waiting,
//         orientation, note, battery }
export function renderDetail(view, { width, height }) {
  const d = view.session;
  const now = Date.now();
  const mode = modeLabel(d.permissionMode);
  const eff = effortLabel(d.effort);
  const meta = [
    d.cwd ? d.cwd.split('/').pop() : null,
    d.model ? d.model.replace(/^claude-/, '') : null,
    eff && eff.toLowerCase(),
    d.startedTs ? 'up ' + fmtDuration(now - d.startedTs) : null,
  ].filter(Boolean).join(' · ');
  const lamp = d.state === 'idle' && d.ended ? 'ended' : d.state;
  const message = d.lastMessage || '';

  const compact = compactLabel(view.compactions?.[d.id], now);
  const info = '<div class="info">' +
    '<div class="dhead' + (compact ? ' has-compact-status' : '') + '"><span class="lamp ' + lamp + '"></span>' +
    '<span class="slabel">' + stateLabel(d.state, d.ended) + '</span>' +
    (compact || mode ? '<span class="head-actions">' +
      (compact ? '<span class="compact-status">' + esc(compact) + '</span>' : '') +
      (mode ? '<span class="mode m-' + mode.toLowerCase() + '">' + mode + '</span>' : '') + '</span>' : '') + '</div>' +
    '<div class="dname">' + esc(d.name) + '</div>' +
    (meta ? '<div class="dmeta">' + esc(meta) + '</div>' : '') +
    activity(d, now) +
    (d.context != null ? contextMeter(d.context) : '') +
    '<div class="stats">' +
    '<div class="stat"><div class="v">' + fmtTokens(d.tokens && d.tokens.out) + '</div><div class="k">TOKENS OUT</div></div>' +
    '<div class="stat"><div class="v">' + fmtTokens(d.tokens && d.tokens.in) + '</div><div class="k">TOKENS IN</div></div>' +
    '<div class="stat"><div class="v">' + fmtTokens(d.cacheRead) + '</div><div class="k">CACHE READ</div></div>' +
    '</div></div>';

  // The task list rides in the paged box ahead of the message, so a long one
  // pages like everything else.
  const plan = d.plan || [];
  const done = plan.filter((p) => p.status === 'completed').length;
  const MARK = { completed: '✓', in_progress: '▶', pending: '○' };
  const planHtml = plan.length
    ? '<ul class="plan">' +
      plan.map((p) => '<li class="' + p.status + '"><span class="m">' + MARK[p.status] + '</span><span>' +
        esc(p.content) + '</span></li>').join('') + '</ul>' +
      (message ? '<div class="sec">LAST MESSAGE</div>' : '')
    : '';
  const msg = '<div class="msg"><div class="msghead"><span class="label">' +
    (plan.length ? 'PLAN · ' + done + '/' + plan.length : 'LAST MESSAGE') +
    '</span><span class="pg" id="pg"></span></div>' +
    '<div class="msgbox"><div class="msgcols' + (message || plan.length ? '' : ' none') + '" id="msg" data-page="' + (view.msgPage || 0) + '">' +
    planHtml + (message ? renderMarkdown(message) : (plan.length ? '' : 'nothing yet')) + '</div></div></div>';

  const html = '<div class="screen detail-screen' + (view.provider === 'codex' ? ' has-compact' : '') + '">' +
    topbar('SESSION', { count: (view.index + 1) + '/' + view.total, linked: view.linked, waiting: view.waiting, battery: view.battery ?? null }) +
    '<div class="detail">' + info + msg + '</div>' +
    legend([['●', 'raise'], ['←→', 'session'], ['↑↓', 'page'], ['BACK', 'list'], ...(view.provider === 'codex' ? [['C', 'compact']] : [])], view.note || '') +
    '</div><script>' + LAYOUT + '</script>';
  return page(html, { width, height, orientation: view.orientation, extraCss: CSS });
}
