#!/usr/bin/env node
// Install/uninstall the command hooks Codex supports. Codex owns trust: the
// installer never writes trusted hashes or bypasses its review screen.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT } from '../src/config.js';
import { CODEX_HOME } from '../src/codex/config.js';
import { mergeCodexHooks } from './codex-hooks-config.js';

const args = process.argv.slice(2);
const remove = args.includes('--remove');
const targetIndex = args.indexOf('--target');
const target = targetIndex >= 0 ? path.resolve(args[targetIndex + 1]) : path.join(CODEX_HOME, 'hooks.json');
let config = {};
if (fs.existsSync(target)) config = JSON.parse(fs.readFileSync(target, 'utf8'));
const script = fileURLToPath(new URL('./codex-hook.js', import.meta.url));
const next = mergeCodexHooks(config, { node: process.execPath, script, port: PORT, remove });
fs.mkdirSync(path.dirname(target), { recursive: true });
if (fs.existsSync(target)) {
  const backup = target + '.kindle-backup-' + Date.now();
  fs.copyFileSync(target, backup); console.log('Backup: ' + backup);
}
const tmp = target + '.tmp-' + process.pid;
fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
fs.renameSync(tmp, target);
console.log((remove ? 'Removed dashboard hooks from ' : 'Installed dashboard hooks into ') + target);
if (!remove) console.log('Review and trust these hooks in Codex (/hooks). Until trusted, Codex skips them.');
