import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isPrivateIPv4, validateNetwork } from '../src/network.js';
import { createHandler } from '../src/http-server.js';
import { createFrameStore } from '../src/frames.js';

const token = 'a3'.repeat(32);

test('Wi-Fi binds only a private address and requires a strong shared secret', () => {
  for (const host of ['10.0.0.5', '172.16.0.2', '172.31.255.254', '192.168.1.247']) {
    assert.ok(isPrivateIPv4(host));
    assert.doesNotThrow(() => validateNetwork({ lanHost: host, deviceToken: token }));
  }
  for (const host of ['0.0.0.0', '127.0.0.1', '8.8.8.8', '172.32.0.1', '192.168.1.999', 'mac.local', '::']) {
    assert.ok(!isPrivateIPv4(host));
    assert.throws(() => validateNetwork({ lanHost: host, deviceToken: token }), /private IPv4/);
  }
  assert.doesNotThrow(() => validateNetwork({}));
  for (const secret of ['', 'short', 'g'.repeat(64)]) {
    assert.throws(() => createHandler({ lanHost: '192.168.1.2', deviceToken: secret }), /deviceToken/);
  }
});

function setup(deviceToken = token) {
  const frames = createFrameStore(); frames.publish(Buffer.from('png'));
  const calls = { keys: [], polls: [], private: [] };
  const handler = createHandler({
    frames, deviceToken, longPollMs: 5,
    onKey: (key) => calls.keys.push(key), onPoll: (...args) => calls.polls.push(args),
    onHook: () => calls.private.push('hook'), status: () => { calls.private.push('status'); return {}; },
    devState: () => { calls.private.push('dev'); return {}; }, devSet: () => calls.private.push('set'),
    devRefresh: () => calls.private.push('refresh'),
  });
  async function request(url, { address = '192.168.1.50', host = '192.168.1.247', method = 'GET' } = {}) {
    const req = new EventEmitter(); Object.assign(req, { url, method, socket: { remoteAddress: address, localAddress: host } });
    const res = new EventEmitter();
    res.writeHead = (status) => { res.status = status; };
    res.end = (body) => { res.body = body; res.writableEnded = true; };
    await handler(req, res);
    return res;
  }
  return { request, calls };
}

test('unauthenticated LAN requests cannot read frames, send keys or fake a connected Kindle', async () => {
  const { request, calls } = setup();
  for (const route of ['/version?since=0', '/frame.png?v=1', '/key?code=21+1&v=1']) {
    for (const auth of ['', '&token=wrong', '&token=' + 'ff'.repeat(32), '&token=' + token + '&token=' + token]) {
      assert.equal((await request(route + auth)).status, 403);
    }
  }
  assert.equal(calls.polls.length, 0);
  assert.equal(calls.keys.length, 0);
  assert.equal((await request('http://[')).status, 400);
});

test('paired Kindle gets frames and sends keys over LAN; local preview stays token-free', async () => {
  const { request, calls } = setup();
  assert.equal((await request('/version?since=0&token=' + token)).body, '1 full\n');
  assert.equal((await request('/frame.png?token=' + token)).body.toString(), 'png');
  assert.equal((await request('/key?code=22+1&v=1&token=' + token)).body, 'ok\n');
  assert.deepEqual(calls.polls, [[false, { address: '192.168.1.50', host: '192.168.1.247' }]]);
  assert.equal(calls.keys[0].local, false);
  assert.equal((await request('/frame.png', { address: '127.0.0.1' })).status, 200);
  assert.equal((await request('/status', { address: '::ffff:127.0.0.1' })).status, 200);
});

test('even paired LAN clients cannot access hooks, status or development routes', async () => {
  const { request, calls } = setup();
  for (const route of ['/', '/status', '/dev/state', '/dev/set', '/dev/refresh', '/hook', '/codex/hook']) {
    const method = route.endsWith('/hook') ? 'POST' : 'GET';
    assert.equal((await request(route + '?token=' + token, { method })).status, 404);
  }
  assert.deepEqual(calls.private, []);
});

test('USB mode remains compatible, and uses the shared secret when paired for Wi-Fi', async () => {
  const peer = { address: '192.168.2.2', host: '192.168.2.1' };
  const paired = setup();
  assert.equal((await paired.request('/frame.png', peer)).status, 403);
  assert.equal((await paired.request('/frame.png?token=' + token, peer)).status, 200);
  assert.equal((await setup('').request('/frame.png', peer)).status, 200);
});

test('Kindle fetch reads its local override and appends the token to both URL forms', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-network-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = fs.readFileSync(new URL('../../kindle/dash/config.sh', import.meta.url), 'utf8')
    .replace('DIR=/mnt/us/dash', 'DIR=' + dir);
  fs.writeFileSync(path.join(dir, 'config.sh'), config);
  fs.writeFileSync(path.join(dir, 'network.local.sh'), `DASH_HOST=192.168.1.247\nDASH_TOKEN=${token}\nDASH_WIFI=1\n`);
  const result = spawnSync('sh', ['-c', `
    . "$1/config.sh"
    wget() { printf '%s' "$4"; }
    fetch 2 "$BASE/version?since=0" "$1/with-query"
    fetch 2 "$BASE/frame.png" "$1/without-query"
  `, 'sh', dir], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'with-query'), 'utf8'), 'http://192.168.1.247:8765/version?since=0&token=' + token);
  assert.equal(fs.readFileSync(path.join(dir, 'without-query'), 'utf8'), 'http://192.168.1.247:8765/frame.png?token=' + token);
});
