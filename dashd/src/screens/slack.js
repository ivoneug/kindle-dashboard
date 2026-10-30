import { esc, topbar, legend, page } from './page.js';
import { renderSlackText, previewSlackText } from '../slack/messages.js';

export const SLACK_PER_PAGE = 4;
const GAP = 40;
const CSS = `
.slack-screen .legend{gap:10px;font-size:15px;letter-spacing:.03em}
.slack-screen .legend .item{gap:6px;white-space:nowrap}
.slack-screen .legend .key{min-width:28px;height:28px;padding:0 5px;font-size:14px}
.slack-grid{flex:1;min-height:0;display:grid;gap:10px;padding:12px 18px}
.portrait .slack-grid{grid-template-rows:repeat(4,minmax(0,1fr))}
.landscape .slack-grid{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr))}
.slack-tile{min-height:0;min-width:0;overflow:hidden;display:flex;flex-direction:column;padding:10px 14px;border:2px solid var(--ink);border-radius:8px}
.slack-tile.selected{border-width:5px;padding:7px 11px}
.slack-byline{display:flex;align-items:baseline;gap:10px;flex:none;margin-bottom:6px}
.slack-author{font-size:20px;font-weight:700;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.slack-time{margin-left:auto;flex:none;font:14px var(--mono);color:var(--ink-3);white-space:nowrap;letter-spacing:0}
.slack-preview{overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;font:18px/1.35 "Helvetica Neue",Arial,sans-serif;overflow-wrap:anywhere}
.landscape .slack-preview{-webkit-line-clamp:4}
.slack-preview code{font:15px var(--mono);background:var(--wash);padding:0 3px}
.slack-tile-foot{margin-top:auto;display:flex;align-items:center;gap:8px;padding-top:6px;flex:none}
.slack-replies{font:14px var(--mono);color:var(--ink-3)}
.slack-new{margin-left:auto;border:2px solid var(--ink);border-radius:5px;padding:0 7px;font-size:14px;font-weight:700;letter-spacing:.08em;line-height:22px;white-space:nowrap}
.slack-empty{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 28px;font-size:21px;font-weight:700;letter-spacing:.08em;line-height:1.5}
.slack-thread{flex:1;min-height:0;display:flex;flex-direction:column;padding:14px 18px 12px}
.slack-thread-heading{display:flex;align-items:center;gap:12px;flex:none;margin-bottom:10px;font:14px var(--mono)}
.slack-thread-heading .channel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slack-thread-heading .thread-page{margin-left:auto;flex:none}
.slack-thread-status{font:14px var(--mono);color:var(--muted);margin-bottom:10px}
.slack-messagebox{flex:1;min-height:0;overflow:hidden}
.slack-columns{height:100%;column-gap:${GAP}px;column-fill:auto;font:18px/1.42 "Helvetica Neue",Arial,sans-serif;overflow-wrap:anywhere}
.slack-post{margin-bottom:18px}
.slack-post+.slack-post{border-top:2px solid var(--faint);padding-top:12px}
.slack-post .slack-byline{break-after:avoid}
.slack-columns p{margin:0 0 10px}
.slack-columns ul,.slack-columns ol{padding-left:26px;margin:0 0 10px}
.slack-columns ul{list-style:square}.slack-columns li{margin:3px 0}
.slack-columns li>p{margin:0}.slack-columns strong{font-weight:700}
.slack-columns blockquote{border-left:3px solid var(--muted);padding-left:10px;margin:0 0 10px;color:var(--ink-3)}
.slack-columns code{font:15px var(--mono);background:var(--wash);padding:0 3px}
.slack-columns pre{white-space:pre-wrap;font:14px/1.35 var(--mono);border-left:4px solid var(--ink);padding:4px 0 4px 10px;margin:0 0 10px}
.slack-columns pre code{background:none;padding:0;font:inherit}
.slack-columns h1,.slack-columns h2,.slack-columns h3{font-size:20px;margin:10px 0;break-after:avoid}
.slack-columns table{border-collapse:collapse;font-size:15px;margin:0 0 10px}
.slack-columns td,.slack-columns th{border:2px solid var(--ink);padding:2px 6px;text-align:left}
`;

function time(ts) {
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function byline(message, users) {
  return '<div class="slack-byline"><span class="slack-author">' + esc(users[message.user] || message.author) +
    '</span><span class="slack-time">' + esc(time(message.id)) + '</span></div>';
}
function status(slack) {
  if (!slack.configured) return 'CONNECT SLACK ON THE MAC';
  if (slack.error) return 'SLACK · ' + slack.error.toUpperCase().replaceAll('_', ' ');
  return slack.loading ? 'LOADING MESSAGES…' : '';
}

export function renderSlack(view, { width, height }) {
  const { slack, selected = 0 } = view;
  const messages = slack.messages, pages = Math.max(1, Math.ceil(messages.length / SLACK_PER_PAGE));
  const pageNo = Math.floor(selected / SLACK_PER_PAGE);
  const tiles = messages.slice(pageNo * SLACK_PER_PAGE, (pageNo + 1) * SLACK_PER_PAGE).map((message, i) =>
    '<div class="slack-tile' + (pageNo * SLACK_PER_PAGE + i === selected ? ' selected' : '') + '">' +
    byline(message, slack.users) + '<div class="slack-preview">' + previewSlackText(message.text, slack.users) + '</div>' +
    '<div class="slack-tile-foot"><span class="slack-replies">' + message.replyCount + ' REPL' + (message.replyCount === 1 ? 'Y' : 'IES') + '</span>' +
    (message.unreadCount ? '<span class="slack-new">NEW MESSAGE' + (message.unreadCount > 1 ? 'S' : '') + '</span>' : '') + '</div></div>').join('');
  const meta = view.note || status(slack) || '#' + slack.channelName + (pages > 1 ? ' · ' + (pageNo + 1) + '/' + pages : '');
  return page('<div class="screen slack-screen">' +
    topbar('SLACK', { count: String(messages.length), linked: view.linked, waiting: view.waiting, battery: view.battery ?? null }) +
    (messages.length ? '<div class="slack-grid">' + tiles + '</div>' : '<div class="slack-empty">' + esc(status(slack) || 'NO MESSAGES IN #' + slack.channelName) + '</div>') +
    legend([['↑↓', 'select'], ['●', 'open'], ['S', 'sessions', view.sessionsChanged]], meta) + '</div>',
  { width, height, orientation: view.orientation, extraCss: CSS });
}

const LAYOUT = `window.__layout=function(){
var el=document.getElementById('slack-message');if(!el)return null;
var box=el.parentElement,step=box.clientWidth+${GAP};
el.style.columnWidth=box.clientWidth+'px';
var pages=Math.max(1,Math.round((el.scrollWidth+${GAP})/step));
var p=Math.max(0,Math.min(pages-1,Number(el.dataset.page)||0));
el.style.transform='translateX('+(-p*step)+'px)';
document.getElementById('thread-page').textContent=(p+1)+'/'+pages;
return{pages:pages,page:p};};`;

export function renderSlackDetail(view, { width, height }) {
  const { slack, message, index = 0, msgPage = 0 } = view;
  const thread = slack.threads[message.id];
  const posts = thread?.messages?.length ? thread.messages : [message];
  const notice = thread?.error ? 'THREAD · ' + thread.error.toUpperCase().replaceAll('_', ' ') :
    !thread?.updatedTs && (thread?.loading || !thread) ? 'LOADING THREAD…' : '';
  const body = '<div class="screen slack-screen">' +
    topbar('THREAD', { count: (index + 1) + '/' + slack.messages.length, linked: view.linked, waiting: view.waiting, battery: view.battery ?? null }) +
    '<div class="slack-thread"><div class="slack-thread-heading"><span class="channel">#' + esc(slack.channelName) +
    '</span><span class="thread-page" id="thread-page"></span></div>' +
    '<div class="slack-messagebox"><div class="slack-columns" id="slack-message" data-page="' + msgPage + '">' +
    posts.map((m) => '<article class="slack-post">' + byline(m, slack.users) + renderSlackText(m.text, slack.users) + '</article>').join('') +
    (notice ? '<div class="slack-thread-status">' + esc(notice) + '</div>' : '') + '</div></div></div>' +
    legend([['↑↓', 'page'], ['←→', 'message'], ['↵', 'end'], ['BACK', 'list'], ['S', 'sessions', view.sessionsChanged]], view.note || '') +
    '</div><script>' + LAYOUT + '</script>';
  return page(body, { width, height, orientation: view.orientation, extraCss: CSS });
}
