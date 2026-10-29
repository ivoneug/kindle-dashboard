import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PNG } from 'pngjs';
import { parseBattery } from '../src/battery.js';
import { createHandler } from '../src/http-server.js';
import { createFrameStore } from '../src/frames.js';
import { encodeGray, pngInfo } from '../src/gray.js';
import { renderBattery } from '../src/screens/battery.js';
import { BATTERY_STATES, offlineBatteryFrames } from '../src/offline-assets.js';

test('battery telemetry preserves 0%, full charge and unknown readings; malformed values are rejected', () => {
  assert.deepEqual(parseBattery('0', '0'), { level: 0, charging: false });
  assert.deepEqual(parseBattery('100', '1'), { level: 100, charging: true });
  assert.deepEqual(parseBattery('unknown', 'unknown'), { level: null, charging: null });
  for (const [level, charging] of [['101', '0'], ['-1', '0'], ['9.5', '0'], ['', '1'], ['40', 'yes'], ['<script>', '1']]) {
    assert.equal(parseBattery(level, charging), null);
  }
  assert.match(renderBattery({ level: 0, charging: false }), /Battery 0%/);
  assert.match(renderBattery({ level: 42, charging: true }), /class="battery charging".*Charging 42%/);
  assert.match(renderBattery({}), /--%/);
});

test('only authenticated Kindle version polls can update battery telemetry', async () => {
  const frames = createFrameStore(); frames.publish(Buffer.from('png'));
  const received = [], token = 'a'.repeat(64);
  const handler = createHandler({ frames, deviceToken: token, longPollMs: 1, onBattery: (b) => received.push(b) });
  async function request(query, address = '192.168.1.147') {
    const req = new EventEmitter(); Object.assign(req, { method: 'GET', url: '/version?since=0&' + query, socket: { remoteAddress: address } });
    const res = new EventEmitter(); res.writeHead = (status) => { res.status = status; }; res.end = () => {};
    await handler(req, res); return res.status;
  }
  assert.equal(await request('battery=60&charging=1'), 403);
  assert.equal(received.length, 0);
  await request('battery=60&charging=1&token=' + token);
  assert.deepEqual(received, [{ level: 60, charging: true }]);
  for (const query of ['battery=101&charging=0', 'battery=40&battery=20&charging=1', 'battery=40&charging=1&charging=0', 'battery=40']) {
    await request(query + '&token=' + token);
  }
  await request('battery=20&charging=0', '127.0.0.1');
  assert.equal(received.length, 1, 'invalid readings and local previews cannot overwrite device telemetry');
});

test('Kindle battery reader normalizes real powerd values and marks failed reads unknown', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-battery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(new URL('../../kindle/dash/battery.sh', import.meta.url), path.join(dir, 'battery.sh'));
  fs.writeFileSync(path.join(dir, 'lipc-get-prop'), '#!/bin/sh\ncase "$2" in battLevel) printf "%s" "$TEST_LEVEL";; isCharging) printf "%s" "$TEST_CHARGING";; esac\n', { mode: 0o755 });
  for (const [level, charging, expected] of [['93', '1', '93 1'], ['000', '0', '0 0'], ['005', '0', '5 0'], ['100', '0', '100 0'], ['', '', 'unknown unknown'], ['101', 'invalid', 'unknown unknown'], ['99.1', '1', 'unknown 1']]) {
    const result = spawnSync('sh', ['-c', '. "$1/battery.sh"; read_battery; printf "%s %s" "$BATTERY_LEVEL" "$BATTERY_CHARGING"', 'sh', dir],
      { encoding: 'utf8', env: { ...process.env, PATH: dir + ':' + process.env.PATH, TEST_LEVEL: level, TEST_CHARGING: charging } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});

test('offline battery assets replace only the badge and remain Kindle-compatible grayscale', () => {
  const pixels = new Uint8Array(600 * 800).fill(255); pixels[700 * 600 + 30] = 0;
  const base = encodeGray(pixels, 600, 800);
  const badges = new Uint8Array(128 * 40 * BATTERY_STATES.length).fill(255);
  // Distinct normal/charging pixels let the test detect using the wrong row.
  badges[9 * 128 + 120] = 0;
  badges[40 * 128 + 9 * 128 + 120] = 102;
  const atlas = encodeGray(badges, 128, 40 * BATTERY_STATES.length);
  const frames = offlineBatteryFrames(base, atlas);
  for (const [name, value] of [['unknown-0.png', 0], ['unknown-1.png', 102]]) {
    const asset = frames.next().value;
    assert.equal(asset.name, name);
    assert.equal(pngInfo(asset.png).colorType, 0);
    const decoded = PNG.sync.read(asset.png);
    assert.equal(decoded.data[((15 + 9) * 600 + 448 + 120) * 4], value);
    assert.equal(decoded.data[(700 * 600 + 30) * 4], 0);
  }
});
