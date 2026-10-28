// Screenshot → what eips can show: 8-bit grayscale PNG, color_type 0, no
// alpha, quantized to the panel's 16 levels. eips silently refuses anything
// else (kindleland), so every frame goes through here.

import { PNG } from 'pngjs';

export const LEVELS = 16;
const STEP = 255 / (LEVELS - 1); // 17

// RGBA → one byte per pixel. Alpha is ignored: screenshots are opaque.
export function toGray(rgba, width, height) {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const luma = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    out[i] = Math.round(Math.round(luma / STEP) * STEP);
  }
  return out;
}

// Quarter turns only; deg is 0, 90 (clockwise), 180 or 270.
export function rotate(gray, width, height, deg) {
  const d = ((deg % 360) + 360) % 360;
  if (d === 0) return { data: gray, width, height };
  const out = new Uint8Array(gray.length);
  const w2 = d === 180 ? width : height;
  const h2 = d === 180 ? height : width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let nx, ny;
      if (d === 90) { nx = height - 1 - y; ny = x; }
      else if (d === 180) { nx = width - 1 - x; ny = height - 1 - y; }
      else { nx = y; ny = width - 1 - x; }
      out[ny * w2 + nx] = gray[y * width + x];
    }
  }
  return { data: out, width: w2, height: h2 };
}

export function encodeGray(gray, width, height) {
  const png = new PNG({ width, height, colorType: 0, inputColorType: 0, bitDepth: 8, inputHasAlpha: false });
  png.data = Buffer.from(gray.buffer, gray.byteOffset, gray.byteLength);
  return PNG.sync.write(png, { colorType: 0, inputColorType: 0, bitDepth: 8, inputHasAlpha: false });
}

export function screenshotToFrame(pngBuffer, { rotateDeg = 0 } = {}) {
  const shot = PNG.sync.read(pngBuffer);
  const gray = toGray(shot.data, shot.width, shot.height);
  const r = rotate(gray, shot.width, shot.height, rotateDeg);
  return { png: encodeGray(r.data, r.width, r.height), width: r.width, height: r.height };
}

// IHDR fields straight from the bytes — what eips will see, independent of
// any decoder's opinion.
export function pngInfo(buf) {
  if (buf.length < 29 || buf.toString('latin1', 12, 16) !== 'IHDR') throw new Error('not a PNG');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
    interlace: buf[28],
  };
}
