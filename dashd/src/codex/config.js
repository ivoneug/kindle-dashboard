import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
// The desktop app bundles the CLI but does not necessarily add it to a user's
// interactive shell PATH. Check both locations, including a user-local install.
const candidates = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  .map((dir) => path.join(dir, 'codex'));
if (process.platform === 'darwin') {
  for (const apps of ['/Applications', path.join(os.homedir(), 'Applications')]) {
    candidates.push(path.join(apps, 'Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'));
  }
}
export const CODEX_BIN = process.env.DASHD_CODEX_BIN || candidates.find((file) => {
  try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; }
}) || 'codex';
export const CODEX_POLL_MS = 3_000;
export const CODEX_LIMIT = 20;
