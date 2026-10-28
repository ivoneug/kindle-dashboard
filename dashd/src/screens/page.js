// Shared page shell: fonts and the e-ink theme inlined, so a frame renders
// from one string with nothing to fetch.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THEME = path.join(__dirname, '..', 'theme');

let css = null;
function themeCss() {
  if (!css) {
    css = fs.readFileSync(path.join(THEME, 'fonts.css'), 'utf8') +
      fs.readFileSync(path.join(THEME, 'eink.css'), 'utf8');
  }
  return css;
}

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function fmtClock(ts = Date.now()) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// waiting: how many asks are waiting on a human; drawn inverted, the e-ink
// stand-in for claude-thing's "saturated colour means a person is needed".
export function topbar(title, { count, linked, waiting } = {}) {
  return '<div class="topbar"><span class="mark"></span>' +
    '<span class="title">' + esc(title) + '</span>' +
    (count ? '<span class="tcount">' + esc(count) + '</span>' : '') +
    '<span class="spacer"></span>' +
    (waiting ? '<span class="waiting">! ' + esc(waiting) + ' WAITING</span>' : '') +
    '<span class="clock">' + fmtClock() + '</span>' +
    '<span class="conn' + (linked ? ' ok' : '') + '"></span></div>';
}

// items: [[keyLabel, text], …]; meta: right-aligned small print.
export function legend(items, meta = '') {
  return '<div class="legend">' +
    items.map(([k, t]) => '<span class="item"><span class="key">' + esc(k) + '</span>' + esc(t) + '</span>').join('') +
    '<span class="spacer"></span>' +
    (meta ? '<span class="meta">' + esc(meta) + '</span>' : '') +
    '</div>';
}

export function contextMeter(fraction) {
  const pct = Math.max(0, Math.min(1, fraction));
  const label = '<span>CONTEXT</span><span>' + Math.round(pct * 100) + '%</span>';
  return '<div class="ctxtrack' + (pct >= 0.8 ? ' hot' : '') + '">' +
    '<span class="ctxtext">' + label + '</span>' +
    '<span class="ctxfill" style="width:' + (pct * 100).toFixed(1) + '%">' +
    '<span class="ctxtext">' + label + '</span></span></div>';
}

export function page(body, { width, height, orientation, extraCss = '' }) {
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    themeCss() +
    `html,body{width:${width}px;height:${height}px}` + extraCss +
    '</style></head><body class="' + esc(orientation) + '">' + body + '</body></html>';
}
