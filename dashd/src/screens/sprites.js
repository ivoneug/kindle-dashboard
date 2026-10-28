// Clawd, claude-thing's mascot (sprites copied from its device-app), for
// e-ink: one still frame of a 4-frame 16×16 strip, scaled by a whole factor
// with crisp edges. The orange body becomes ink; every other colour (sweat,
// sparkle, the "!" lamp, the dimmed sleeping palette) becomes a gray by its
// own lightness, so accents stay visible without competing with the body.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '..', 'sprites');
const BODY = new Set(['#d77757', '#8f4c30']);
const FRAME = 16;

const cache = new Map();

function rects(name) {
  if (!cache.has(name)) {
    const svg = fs.readFileSync(path.join(DIR, name + '.svg'), 'utf8');
    const re = /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(#[0-9a-f]{6})"/g;
    const list = [];
    for (let m; (m = re.exec(svg));) {
      list.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], fill: m[5] });
    }
    cache.set(name, list);
  }
  return cache.get(name);
}

// 0 = ink, 255 = paper.
function grayOf(hex) {
  if (BODY.has(hex)) return 0;
  const n = parseInt(hex.slice(1), 16);
  const luma = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return Math.min(0xbb, Math.round(luma * 0.75));
}

// A stable frame per key (a session id): tiles differ from each other, but the
// same tile never changes between renders — a frame that changes with nothing
// else costs the Kindle a redraw.
export function frameFor(key) {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 4;
}

// inverted: drawn on an ink background (the ATTENTION tile), so ink and paper
// swap.
export function sprite(name, { frame = 0, size = 64, inverted = false, className = 'sprite' } = {}) {
  const x0 = frame * FRAME;
  let body = '';
  for (const r of rects(name)) {
    if (r.x < x0 || r.x >= x0 + FRAME) continue;
    const g = inverted ? 255 - grayOf(r.fill) : grayOf(r.fill);
    body += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="rgb(${g},${g},${g})"/>`;
  }
  return `<svg class="${className}" width="${size}" height="${size}" viewBox="${x0} 0 ${FRAME} ${FRAME}" ` +
    `shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}
