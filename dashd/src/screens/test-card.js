// M1 test card. Proves the pipe end to end and doubles as the M0 key-code
// probe: every key the Kindle sends shows up here, raw, on the next frame.
// Also carries what has to be judged on the real panel before any real screen
// is designed: the 16-level ramp, type sizes, line weights, inversion, hazard
// band, the context meter — in whichever orientation is being tried.

import { esc, topbar, legend, contextMeter, page } from './page.js';

const CSS = `
.body { flex: 1; display: flex; gap: 18px; padding: 16px 18px; min-height: 0; }
.col { flex: 1; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.portrait .body { flex-direction: column; gap: 12px; padding: 12px 18px; }
.portrait .col { flex: none; gap: 11px; }

.lastkey { border: 2px solid var(--ink); padding: 10px 12px; }
.lastkey .code { font-family: "JetBrains Mono", monospace; font-size: 48px; line-height: 1.1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lastkey .code.none { font-family: "Chakra Petch", sans-serif; font-size: 19px; letter-spacing: 0.16em;
  font-weight: 700; color: var(--muted); padding: 14px 0; }
.history { margin-top: 6px; font-family: "JetBrains Mono", monospace; font-size: 15px; color: var(--ink-3); }
.history div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.ramp { display: flex; border: 2px solid var(--ink); }
.ramp span { flex: 1; height: 40px; display: flex; align-items: flex-end; justify-content: center;
  font-family: "JetBrains Mono", monospace; font-size: 14px; padding-bottom: 2px; }

.type .h { font-weight: 700; font-size: 19px; letter-spacing: 0.16em; }
.type .b { font-size: 14px; color: var(--ink-3); }
.type .m19 { font-family: "JetBrains Mono", monospace; font-size: 19px; }
.type .m14 { font-family: "JetBrains Mono", monospace; font-size: 14px; }
.type > div { margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.lines { display: flex; flex-direction: column; gap: 6px; }
.lines .row { display: flex; align-items: center; gap: 10px; font-family: "JetBrains Mono", monospace; font-size: 14px; }
.lines .row b { flex: 1; background: var(--ink); }

.attn { background: var(--ink); color: var(--paper); padding: 10px 12px; display: flex; align-items: center; gap: 12px; }
.attn .t { font-weight: 700; font-size: 19px; letter-spacing: 0.16em; flex: 1; }
.attn .bang { width: 30px; height: 30px; background: var(--paper); color: var(--ink); font-weight: 700;
  font-size: 22px; display: flex; align-items: center; justify-content: center; }
`;

function lastKeyBlock(keys) {
  if (!keys.length) {
    return '<div class="lastkey"><div class="code none">PRESS ANY KEY ON THE KINDLE</div></div>';
  }
  const [last, ...rest] = keys;
  return '<div class="lastkey">' +
    '<div class="code">' + esc(last.name || last.code) + '</div>' +
    '<div class="history">' +
    [last, ...rest].map((k) =>
      '<div>v' + k.v + ' · ' + esc(k.code) + (k.name ? ' ' + esc(k.name) : '') +
      (k.action ? ' → ' + esc(k.action) : '') + (k.stale ? ' · stale' : '') + '</div>'
    ).join('') +
    '</div></div>';
}

function ramp() {
  let html = '<div class="ramp">';
  for (let i = 0; i < 16; i++) {
    const g = i * 17;
    const fg = i < 8 ? '#fff' : '#000';
    html += `<span style="background:rgb(${g},${g},${g});color:${fg}">${i.toString(16).toUpperCase()}</span>`;
  }
  return html + '</div>';
}

function typeBlock() {
  return '<div class="type">' +
    '<div class="h">PERMISSION REQUEST · DESTRUCTIVE</div>' +
    '<div class="b">you asked: fix the failing build and push it — 14px body</div>' +
    '<div class="m19">$ rm -rf build/ &amp;&amp; git push --force</div>' +
    '<div class="m14">opus-5-5 · high · 12:04 · 0123456789</div>' +
    '</div>';
}

function linesBlock() {
  return '<div class="lines">' +
    [1, 2, 3, 4].map((w) => `<div class="row">${w}px<b style="height:${w}px"></b></div>`).join('') +
    '</div>';
}

export function renderTestCard(state, { width, height }) {
  const keys = state.keys || [];
  const left = '<div class="col">' +
    '<div class="label">LAST KEY</div>' + lastKeyBlock(keys) +
    '<div class="label">GRAY · 16 LEVELS</div>' + ramp() +
    '</div>';
  const right = '<div class="col">' +
    '<div class="label">TYPE</div>' + typeBlock() +
    '<div class="label">LINES · SHAPES</div>' + linesBlock() +
    '<div class="hazard"></div>' +
    '<div class="attn"><span class="t">ATTENTION</span><span class="bang">!</span></div>' +
    contextMeter(0.42) + contextMeter(0.86) +
    '</div>';
  const meta = 'v' + state.version + ' · ' + state.orientation.toUpperCase();
  const body = '<div class="screen">' +
    topbar('KINDLE DASH', { count: 'M1', linked: state.linked }) +
    '<div class="body">' + left + right + '</div>' +
    legend([['Y', 'allow'], ['N', 'deny'], ['BACK', 'terminal']], meta) +
    '</div>';
  return page(body, { width, height, orientation: state.orientation, extraCss: CSS });
}
