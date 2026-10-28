import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { toGray, rotate, encodeGray, screenshotToFrame, pngInfo } from '../src/gray.js';

function rgbaPng(width, height, pixel) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * width + x) * 4;
      png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = a;
    }
  }
  return PNG.sync.write(png);
}

test('frames are 8-bit grayscale, color_type 0, not interlaced — what eips accepts', () => {
  const shot = rgbaPng(8, 4, (x) => [x * 30, 100, 200, 255]);
  const { png } = screenshotToFrame(shot);
  assert.deepEqual(pngInfo(png), { width: 8, height: 4, bitDepth: 8, colorType: 0, interlace: 0 });
});

test('every pixel lands on one of the 16 panel levels', () => {
  const rgba = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) rgba.set([i, i, i, 255], i * 4);
  const gray = toGray(rgba, 256, 1);
  for (const v of gray) assert.equal(v % 17, 0, `level ${v}`);
  assert.equal(gray[0], 0);
  assert.equal(gray[255], 255);
  assert.equal(new Set(gray).size, 16);
});

test('colour turns into luma, not into a channel', () => {
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
  const [red, green] = toGray(rgba, 2, 1);
  assert.ok(green > red);
});

test('a landscape frame turns onto the portrait panel', () => {
  // 3×2, values = index; clockwise quarter turn.
  const src = Uint8Array.from([0, 1, 2, 3, 4, 5]);
  const cw = rotate(src, 3, 2, 90);
  assert.equal(cw.width, 2);
  assert.equal(cw.height, 3);
  assert.deepEqual([...cw.data], [3, 0, 4, 1, 5, 2]);
  const ccw = rotate(src, 3, 2, 270);
  assert.deepEqual([...ccw.data], [2, 5, 1, 4, 0, 3]);
  assert.deepEqual([...rotate(src, 3, 2, 180).data], [5, 4, 3, 2, 1, 0]);
});

test('encoded gray decodes back to the same pixels', () => {
  const gray = Uint8Array.from({ length: 12 }, (_, i) => (i % 16) * 17);
  const back = PNG.sync.read(encodeGray(gray, 4, 3));
  for (let i = 0; i < gray.length; i++) assert.equal(back.data[i * 4], gray[i]);
});
