// Queue: everything waiting on a human, after claude-thing's queue screen.
// The hero — the ask the keys act on — fills the screen under the hazard band;
// the next ones stack below it. Permissions are answered right here (Y / N /
// Back: answer it on the Mac — in the terminal or the Claude app, wherever the
// session lives). Questions and plans cannot be answered by any hook, so
// the Kindle shows them and raises the session's window; the answer is given
// there.

import { esc, topbar, legend, page } from './page.js';
import { fmtDuration } from './helpers.js';

const STACK = 2;

const CSS = `
.queue { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 14px 18px 12px; }
.hero { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; overflow: hidden;
  border: 3px solid var(--ink); border-radius: 8px; padding: 0 16px 12px; }
.hero .hazard { margin: 0 -16px 4px; }
.qhead { display: flex; align-items: baseline; gap: 12px; }
.qkind { flex: 1; font-weight: 700; font-size: 18px; letter-spacing: 0.14em; }
.qwait { font-family: var(--mono); font-size: 16px; }
.qname { font-weight: 700; font-size: 28px; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qintent { font-family: var(--mono); font-size: 15px; color: var(--ink-3); overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.qtool { align-self: flex-start; padding: 0 8px; background: var(--ink); color: var(--paper);
  font-weight: 700; font-size: 16px; letter-spacing: 0.14em; line-height: 26px; }
.qsummary { flex: 1; min-height: 0; overflow: hidden; font-family: var(--mono); font-size: 19px; line-height: 1.35;
  white-space: pre-wrap; overflow-wrap: anywhere; }
.qquestion { font-size: 21px; line-height: 1.3; font-weight: 700; }
.qopts { margin: 0; padding-left: 26px; font-size: 18px; line-height: 1.35; }
.qopts li { margin: 3px 0; }
.qopts .d { display: block; font-size: 14px; color: var(--ink-3); }
.qnote { font-family: var(--mono); font-size: 14px; color: var(--ink-3); }
.armed { padding: 6px 10px; background: var(--ink); color: var(--paper); text-align: center;
  font-weight: 700; font-size: 20px; letter-spacing: 0.14em; }

.stack { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
.card { display: flex; gap: 10px; align-items: baseline; padding: 6px 12px; border: 2px solid var(--ink); border-radius: 6px;
  white-space: nowrap; overflow: hidden; }
.card .k { font-weight: 700; font-size: 14px; letter-spacing: 0.14em; }
.card .n { font-weight: 700; font-size: 17px; }
.card .s { flex: 1; min-width: 0; font-family: var(--mono); font-size: 15px; overflow: hidden; text-overflow: ellipsis; }
.more { font-weight: 700; font-size: 14px; letter-spacing: 0.14em; text-align: center; }

.empty { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center;
  padding: 0 40px; font-weight: 700; font-size: 22px; letter-spacing: 0.16em; line-height: 1.5; }
`;

function waited(a, now) {
  return 'WAITING ' + fmtDuration(now - a.createdTs);
}

function permissionHero(a, now, armed) {
  const left = a.timeoutMs ? Math.max(0, a.createdTs + a.timeoutMs - now) : 0;
  return '<div class="hero"><div class="hazard"></div>' +
    '<div class="qhead"><span class="qkind">PERMISSION REQUEST' + (a.destructive ? ' · DESTRUCTIVE' : '') + '</span>' +
    '<span class="qwait">' + waited(a, now) + '</span></div>' +
    '<div class="qname">' + esc(a.sessionName || 'session') + '</div>' +
    (a.intent ? '<div class="qintent">' + esc(a.intent) + '</div>' : '') +
    '<div class="qtool">' + esc(String(a.tool || '').toUpperCase()) + '</div>' +
    '<div class="qsummary">' + esc(a.summary || '') + '</div>' +
    (armed ? '<div class="armed">PRESS Y AGAIN TO ALLOW</div>' : '') +
    (left ? '<div class="qnote">goes back to the Mac in ' + fmtDuration(left) + ' if not answered here</div>' : '') +
    '</div>';
}

function questionHero(a, now) {
  const q = (a.questions && a.questions[0]) || a;
  const plan = q.header === 'PLAN';
  const opts = (q.options || []).map((o) =>
    '<li>' + esc(o.label) + (o.description ? '<span class="d">' + esc(o.description) + '</span>' : '') + '</li>'
  ).join('');
  const more = a.questions && a.questions.length > 1 ? ' (+' + (a.questions.length - 1) + ' more)' : '';
  return '<div class="hero"><div class="hazard"></div>' +
    '<div class="qhead"><span class="qkind">' + (plan ? 'PLAN APPROVAL' : 'QUESTION') + '</span>' +
    '<span class="qwait">' + waited(a, now) + '</span></div>' +
    '<div class="qname">' + esc(a.sessionName || 'session') + '</div>' +
    (a.intent ? '<div class="qintent">' + esc(a.intent) + '</div>' : '') +
    '<div class="qquestion">' + esc((q.question || '') + more) + '</div>' +
    (opts ? '<ol class="qopts">' + opts + '</ol>' : '') +
    '<div class="qnote">answer it in the session\'s window — centre raises it</div>' +
    '</div>';
}

function card(a) {
  const isPerm = a.kind === 'permission';
  const what = isPerm ? (a.tool ? a.tool + ' · ' : '') + (a.summary || '') : (a.question || '');
  return '<div class="card"><span class="k">' + (isPerm ? (a.destructive ? 'PERMISSION !' : 'PERMISSION') : 'QUESTION') + '</span>' +
    '<span class="n">' + esc(a.sessionName || 'session') + '</span>' +
    '<span class="s">' + esc(what) + '</span></div>';
}

// view: { asks (oldest first), heroId, armed, linked, orientation, note }
export function renderQueue(view, { width, height }) {
  const asks = view.asks;
  const now = Date.now();
  let body;
  let keys;
  if (!asks.length) {
    body = '<div class="empty">NOTHING WAITING ON YOU</div>';
    keys = [['S', 'sessions']];
  } else {
    const i = Math.max(0, asks.findIndex((a) => a.id === view.heroId));
    const hero = asks[i];
    const rest = asks.filter((a) => a !== hero);
    body = '<div class="queue">' +
      (hero.kind === 'permission' ? permissionHero(hero, now, view.armed) : questionHero(hero, now)) +
      (rest.length ? '<div class="stack">' + rest.slice(0, STACK).map(card).join('') +
        (rest.length > STACK ? '<div class="more">+' + (rest.length - STACK) + ' MORE</div>' : '') + '</div>' : '') +
      '</div>';
    keys = hero.kind === 'permission'
      ? [['Y', 'allow'], ['N', 'deny'], ['BACK', 'on Mac']]
      : [['●', 'raise']];
    if (rest.length) keys.push(['↑↓', 'next']);
  }
  const html = '<div class="screen">' +
    topbar('QUEUE', { count: asks.length ? String(asks.length) : '', linked: view.linked }) +
    body +
    legend(keys, view.note || '') +
    '</div>';
  return page(html, { width, height, orientation: view.orientation, extraCss: CSS });
}
