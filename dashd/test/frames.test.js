import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameStore } from '../src/frames.js';

const png = Buffer.from('x');

test('first frame is always full, then every fullEvery-th', () => {
  const s = createFrameStore({ fullEvery: 2 });
  const fulls = [];
  for (let i = 0; i < 7; i++) fulls.push(s.get(s.publish(png)).full);
  assert.deepEqual(fulls, [true, false, false, true, false, false, true]);
});

test('an explicit full resets the partial count', () => {
  const s = createFrameStore({ fullEvery: 2 });
  s.publish(png);                 // 1 full (first)
  s.publish(png);                 // 2
  s.publish(png, { full: true }); // 3 full (asked)
  const fulls = [];
  for (let i = 0; i < 3; i++) fulls.push(s.get(s.publish(png)).full);
  assert.deepEqual(fulls, [false, false, true]);
});

test('a client that skipped over a full frame still gets told to flash', () => {
  const s = createFrameStore({ fullEvery: 100 });
  s.publish(png);             // 1 full
  s.publish(png);             // 2
  s.publish(png, { full: true }); // 3 full
  s.publish(png);             // 4
  assert.equal(s.status(2).full, true);
  assert.equal(s.status(3).full, false);
});

test('unknown screens (fresh client, dashd restarted under it) refresh fully', () => {
  const s = createFrameStore({ fullEvery: 100 });
  s.publish(png);
  s.publish(png);
  assert.equal(s.status(0).full, true);
  assert.equal(s.status(57).full, true);
});

test('long-poll answers at once when the version differs — larger or not', async () => {
  const s = createFrameStore();
  s.publish(png);
  assert.equal((await s.waitForChange(0, 1000).promise).version, 1);
  assert.equal((await s.waitForChange(57, 1000).promise).version, 1);
});

test('long-poll holds until a new frame, then wakes', async () => {
  const s = createFrameStore();
  s.publish(png);
  const w = s.waitForChange(1, 5000);
  setTimeout(() => s.publish(png), 20);
  assert.deepEqual(await w.promise, { version: 2, full: false });
});

test('long-poll gives up with the unchanged version', async () => {
  const s = createFrameStore();
  s.publish(png);
  const t0 = Date.now();
  assert.equal((await s.waitForChange(1, 50).promise).version, 1);
  assert.ok(Date.now() - t0 >= 45);
});

test('only the last few frames are kept', () => {
  const s = createFrameStore({ keep: 2 });
  for (let i = 0; i < 5; i++) s.publish(png);
  assert.equal(s.get(3), null);
  assert.ok(s.get(4));
  assert.ok(s.get(5));
});
