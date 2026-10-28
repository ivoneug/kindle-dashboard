// Writes kindle/dash/test.png for M0: 600×800, the 16 panel grays as bands, a
// solid "TOP" marker so orientation is obvious — encoded by the same code as
// every frame (gray.js), so if eips shows this it will show the frames.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeGray } from '../src/gray.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(__dirname, '..', '..', 'kindle', 'dash', 'test.png');

const W = 600;
const H = 800;
const gray = new Uint8Array(W * H).fill(255);
const fill = (x0, y0, x1, y1, v) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) gray[y * W + x] = v;
};

// Top marker: a black block with a white arrow pointing up.
fill(0, 0, W, 120, 0);
for (let row = 0; row < 80; row++) {
  const half = Math.floor(row * 0.75);
  fill(W / 2 - half, 20 + row, W / 2 + half + 1, 21 + row, 255);
}
// 16 bands, black → white.
const bandH = Math.floor((H - 160) / 16);
for (let i = 0; i < 16; i++) fill(40, 140 + i * bandH, W - 40, 140 + (i + 1) * bandH, i * 17);
// 2px frame around the panel edge to see the visible area.
fill(0, 0, W, 2, 0); fill(0, H - 2, W, H, 0); fill(0, 0, 2, H, 0); fill(W - 2, 0, W, H, 0);

fs.writeFileSync(out, encodeGray(gray, W, H));
console.log(`wrote ${path.relative(process.cwd(), out)}`);
