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

test('changing only DASH_WIFI selects the saved LAN or USB address', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-transport-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'config.sh'), fs.readFileSync(new URL('../../kindle/dash/config.sh', import.meta.url), 'utf8')
    .replace('DIR=/mnt/us/dash', 'DIR=' + dir));
  function read(settings) {
    fs.writeFileSync(path.join(dir, 'network.local.sh'), settings);
    return spawnSync('sh', ['-c', '. "$1/config.sh"; printf "%s" "$BASE"', 'sh', dir], { encoding: 'utf8' });
  }
  const addresses = 'DASH_USB_HOST=192.168.3.1\nDASH_LAN_HOST=192.168.1.247\nDASH_PORT=8766\n';
  for (const wifi of [1, 0, 1]) {
    const result = read(addresses + `DASH_WIFI=${wifi}\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `http://${wifi ? '192.168.1.247' : '192.168.3.1'}:8766`);
  }
  // Old generated files used DASH_HOST for the LAN address. The flag must
  // also be sufficient to return those installations to USB.
  assert.equal(read('DASH_HOST=192.168.1.247\nDASH_WIFI=0\n').stdout, 'http://192.168.2.1:8765');
  assert.equal(read('').stdout, 'http://192.168.2.1:8765');
  for (const settings of ['DASH_WIFI=1\n', 'DASH_WIFI=invalid\n']) {
    assert.notEqual(read(settings).status, 0);
  }
});

test('setup keeps both endpoints and the pairing key when switching transports', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-setup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const subdir of ['scripts', 'dashd/src', 'kindle/dash']) fs.mkdirSync(path.join(dir, subdir), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const file of ['scripts/kindle-wifi-setup.mjs', 'dashd/src/network.js']) {
    fs.copyFileSync(new URL('../../' + file, import.meta.url), path.join(dir, file));
  }
  const configPath = path.join(dir, 'dashd/.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ lanHost: '192.168.1.247', usbHost: '192.168.3.1', deviceToken: token, agent: 'claude' }));
  for (const args of [['--usb'], ['--host', '192.168.1.247']]) {
    const result = spawnSync(process.execPath, [path.join(dir, 'scripts/kindle-wifi-setup.mjs'), ...args], {
      env: { PATH: process.env.PATH, DASHD_CONFIG: configPath }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes(token));
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(config.deviceToken, token);
    assert.equal(config.agent, 'claude');
    const local = fs.readFileSync(path.join(dir, 'kindle/dash/network.local.sh'), 'utf8');
    assert.match(local, /DASH_USB_HOST=192\.168\.3\.1\n/);
    assert.match(local, /DASH_LAN_HOST=192\.168\.1\.247\n/);
    assert.ok(local.includes(`DASH_WIFI=${args[0] === '--usb' ? 0 : 1}\n`));
    assert.ok(local.includes(`DASH_TOKEN=${token}\n`));
  }
});
