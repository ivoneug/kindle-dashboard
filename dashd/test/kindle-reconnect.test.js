import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function runClient(t, stub) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-reconnect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'run'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.copyFileSync(new URL('../../kindle/dash/battery.sh', import.meta.url), path.join(dir, 'battery.sh'));
  fs.writeFileSync(path.join(dir, 'run/battLevel'), '93');
  fs.writeFileSync(path.join(dir, 'run/isCharging'), '0');
  fs.writeFileSync(path.join(dir, 'run/enable'), '1');
  fs.writeFileSync(path.join(dir, 'bin/lipc-get-prop'), '#!/bin/sh\ncat "$KINDLE_TEST_RUN/$2"\n', { mode: 0o755 });
  const client = fs.readFileSync(new URL('../../kindle/dash/client.sh', import.meta.url), 'utf8')
    .replace('. /mnt/us/dash/config.sh', '. "$1/config.sh"');
  fs.writeFileSync(path.join(dir, 'client.sh'), client);
  fs.writeFileSync(path.join(dir, 'offline.png'), 'offline');
  fs.writeFileSync(path.join(dir, 'config.sh'), `
    DIR="$1"; RUN="$1/run"; PATH="$1/bin:$PATH"; BASE=http://mac; DASH_WIFI=1; EIPS_FULL=-f; EIPS_PARTIAL=
    E1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; E2=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
    I=0
    eips() { printf '%s\\n' "$*" >> "$RUN/draws"; return 0; }
    sleep() { echo "$1" >> "$RUN/delays"; }
    ${stub}
  `);
  const r = spawnSync('sh', [path.join(dir, 'client.sh'), dir], { encoding: 'utf8', timeout: 4000,
    env: { ...process.env, KINDLE_TEST_RUN: path.join(dir, 'run') } });
  assert.equal(r.status, 0, r.stderr);
  return { dir, read: (file) => fs.readFileSync(path.join(dir, 'run', file), 'utf8') };
}

test('Kindle restores a full frame with the same version after a daemon restart', (t) => {
  const { read } = runClient(t, `
    fetch() {
      case "$2" in
        */version*) I=$((I + 1)); case "$I" in
          1) echo "1 full epoch=$E1" > "$3" ;;
          2) echo "1 full epoch=$E2" > "$3" ;;
          *) exit 0 ;; esac ;;
        *) echo frame > "$3" ;;
      esac
    }
  `);
  assert.equal(read('shown'), '1 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n');
  const draws = read('draws').trim().split('\n');
  assert.equal(draws.length, 2);
  assert.ok(draws.every((s) => s.startsWith('-f -g ')));
});

test('Kindle shows offline once, disables keys, backs off and recovers with a full refresh', (t) => {
  const { read } = runClient(t, `
    fetch() {
      case "$2" in
        */version*) I=$((I + 1)); case "$I" in
          1) echo "7 full epoch=$E1" > "$3" ;;
          2|3|4|5) return 1 ;;
          6) [ ! -f "$RUN/shown" ] || exit 42; echo "7 epoch=$E1" > "$3" ;;
          *) exit 0 ;; esac ;;
        *) echo frame > "$3" ;;
      esac
    }
  `);
  assert.equal(read('delays'), '2\n4\n8\n15\n');
  assert.equal(read('draws').split('offline.png').length - 1, 1);
  assert.equal(read('shown'), '7 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n');
  assert.ok(read('draws').trim().split('\n').at(-1).startsWith('-f -g '));
});

test('a failed frame download cannot enable keys for an undrawn permission', (t) => {
  const { dir, read } = runClient(t, `
    fetch() {
      case "$2" in */version*) I=$((I + 1)); [ "$I" = 1 ] || exit 0; echo "9 full epoch=$E1" > "$3" ;;
      *) return 1 ;; esac
    }
  `);
  assert.ok(!fs.existsSync(path.join(dir, 'run/shown')));
  assert.ok(read('draws').includes('offline.png'));
});

test('offline battery and charging changes update locally without redrawing unchanged values', (t) => {
  const { read } = runClient(t, `
    mkdir -p "$DIR/offline"
    touch "$DIR/offline/93-0.png" "$DIR/offline/93-1.png" "$DIR/offline/92-1.png"
    fetch() {
      printf '%s\\n' "$2" >> "$RUN/urls"
      I=$((I + 1))
      case "$I" in 2) echo 1 > "$RUN/isCharging" ;; 4) echo 92 > "$RUN/battLevel" ;; 5) exit 0 ;; esac
      return 1
    }
  `);
  const draws = read('draws').trim().split('\n');
  assert.equal(draws.length, 3);
  assert.ok(draws[0].includes('-f -g ') && draws[0].endsWith('93-0.png'));
  assert.ok(draws[1].startsWith('-g ') && draws[1].endsWith('93-1.png'));
  assert.ok(draws[2].endsWith('92-1.png'));
  assert.match(read('urls'), /battery=93&charging=0/);
  assert.match(read('urls'), /battery=92&charging=1/);
});
