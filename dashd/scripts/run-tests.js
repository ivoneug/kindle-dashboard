// Imported tests also create fake Claude transcripts. Keep all of that under a
// temporary Claude home, never alongside the user's real conversations.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-tests-'));
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory()
    ? files(path.join(dir, e.name)) : e.name.endsWith('.test.js') ? [path.join(dir, e.name)] : []);
}
try {
  const r = spawnSync(process.execPath, ['--test', ...files('test')], { stdio: 'inherit',
    env: { ...process.env, CLAUDE_CONFIG_DIR: temp, CLAUDE_THING_HOLD_MS: '200', DASHD_COMPACT_FILE: path.join(temp, 'compact.json') } });
  process.exitCode = r.status ?? 1;
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
