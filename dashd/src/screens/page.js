// Shared page shell: fonts and the e-ink theme inlined, so a frame renders
// from one string with nothing to fetch.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBattery, BATTERY_CSS } from './battery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THEME = path.join(__dirname, '..', 'theme');

let css = null;
function themeCss() {
  if (!css) {
    css = fs.readFileSync(path.join(THEME, 'fonts.css'), 'utf8') + BATTERY_CSS +
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

export function topbarStatus({ linked, battery }) {
  return '<span class="topbar-status"><span class="clock">' + fmtClock() + '</span>' +
    '<span class="conn' + (linked ? ' ok' : '') + '"></span>' + renderBattery(battery, { compact: true }) + '</span>';
}

export function weeklyUsage(usage) {
  const limits = (usage?.limits || []).filter((l) => Number.isFinite(l.used));
  // Prefer the main Codex bucket or Claude's combined week, never the 5h window
  // or a model-specific Claude limit. Window metadata survives custom labels.
  const weekly = limits.find((l) => l.key === 'codex' && l.windowMinutes === 10080) ||
    limits.find((l) => l.windowMinutes === 10080) ||
    limits.find((l) => l.key === 'week-all-models' || l.key === 'week');
  const pct = weekly ? Math.round(Math.max(0, Math.min(1, weekly.used)) * 100) : '--';
  return '<span class="weekly-usage" aria-label="7-day limit used ' + pct + '%">7D ' + pct + '%</span>';
}

// Omit battery for the clock-only header; null shows an unknown battery level.
// waiting counts asks that need a human, drawn inverted for e-ink.
export function topbar(title, { count, linked, waiting, battery } = {}) {
  return '<div class="topbar"><span class="mark"></span>' +
    '<span class="title">' + esc(title) + '</span>' +
    (count ? '<span class="tcount">' + esc(count) + '</span>' : '') +
    '<span class="spacer"></span>' +
    (waiting ? '<span class="waiting">! ' + esc(waiting) + ' WAITING</span>' : '') +
    (battery !== undefined ? topbarStatus({ linked, battery }) :
      '<span class="clock">' + fmtClock() + '</span>' +
      '<span class="conn' + (linked ? ' ok' : '') + '"></span>') + '</div>';
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
