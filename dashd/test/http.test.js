import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createFrameStore } from '../src/frames.js';
import { createHandler, isLoopback } from '../src/http-server.js';

async function withServer(fn) {
  const frames = createFrameStore();
  const keys = [];
  const handler = createHandler({
    frames,
    longPollMs: 200,
    onKey: (k) => keys.push(k),
    devState: () => ({ version: frames.version }),
    devSet: () => {},
    devRefresh: () => {},
  });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ base, frames, keys });
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

const get = async (url) => {
  const r = await fetch(url);
  return { status: r.status, body: Buffer.from(await r.arrayBuffer()) };
};

test('/version answers in plain text, with the full flag', async () => {
  await withServer(async ({ base, frames }) => {
    frames.publish(Buffer.from('a'));
    assert.equal((await get(`${base}/version?since=0`)).body.toString(), '1 full\n');
    frames.publish(Buffer.from('b'));
    assert.equal((await get(`${base}/version?since=1`)).body.toString(), '2\n');
    // nothing new: held, then the same version back
    assert.equal((await get(`${base}/version?since=2`)).body.toString(), '2\n');
  });
});

test('/frame.png serves the asked-for version, 404 once it is gone', async () => {
  await withServer(async ({ base, frames }) => {
    frames.publish(Buffer.from('one'));
    frames.publish(Buffer.from('two'));
    assert.equal((await get(`${base}/frame.png?v=1`)).body.toString(), 'one');
    assert.equal((await get(`${base}/frame.png`)).body.toString(), 'two');
    assert.equal((await get(`${base}/frame.png?v=9`)).status, 404);
  });
});

test('/key passes the raw code on and flags presses on an old frame', async () => {
  await withServer(async ({ base, frames, keys }) => {
    frames.publish(Buffer.from('a'));
    frames.publish(Buffer.from('b'));
    assert.equal((await get(`${base}/key?code=102+1&v=2`)).body.toString(), 'ok\n');
    assert.equal((await get(`${base}/key?code=158+1&v=1`)).body.toString(), 'stale\n');
    assert.equal((await get(`${base}/key?v=2`)).status, 400);
    assert.deepEqual(keys.map((k) => [k.code, k.v, k.stale]), [['102 1', 2, false], ['158 1', 1, true]]);
  });
});

test('dev routes exist for loopback', async () => {
  await withServer(async ({ base }) => {
    assert.equal((await get(`${base}/`)).status, 200);
    assert.equal((await get(`${base}/dev/state`)).status, 200);
  });
});

test('loopback detection', () => {
  assert.ok(isLoopback('127.0.0.1'));
  assert.ok(isLoopback('::ffff:127.0.0.1'));
  assert.ok(isLoopback('::1'));
  assert.ok(!isLoopback('192.168.2.2'));
  assert.ok(!isLoopback('::ffff:192.168.2.2'));
  assert.ok(!isLoopback(undefined));
});
