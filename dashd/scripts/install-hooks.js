// Merges dashd's hooks into ~/.claude/settings.json (backup written).
// Uses Claude Code's native type:"http" hooks POSTing to dashd's bare /hook
// endpoint on loopback (event identified by hook_event_name in the payload).
// Failures are non-blocking for Claude Code, and the PermissionRequest flow
// answers "ask" whenever dashd is absent, silent or has no Kindle attached, so
// the terminal prompt always remains the fallback.
//
// Imported from claude-thing's daemon/scripts/install-hooks.js.

import fs from 'node:fs';
import { CLAUDE_SETTINGS, HOOK_TIMEOUT_S } from '../src/claude/config.js';
import { PORT } from '../src/config.js';

const HOOK_URL = `http://127.0.0.1:${PORT}/hook`;
// claude-thing's own daemon. Two permission bridges on one event would race
// for the answer, so its hooks have to go before ours come in.
const CLAUDE_THING_HOOK = ':8790/hook';

function httpHook(timeout) {
  return { matcher: '*', hooks: [{ type: 'http', url: HOOK_URL, timeout }] };
}

const EVENTS = {
  PermissionRequest: httpHook(HOOK_TIMEOUT_S),   // held while a Kindle is attached
  SessionStart: httpHook(5),
  SessionEnd: httpHook(3),
  UserPromptSubmit: httpHook(5),
  PreToolUse: httpHook(5),
  PostToolUse: httpHook(5),
  Stop: httpHook(5),
};

let settings = {};
try { settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8')); } catch {}

if (JSON.stringify(settings.hooks || {}).includes(CLAUDE_THING_HOOK)) {
  console.error('claude-thing hooks (:8790) are installed — remove them first ' +
    '(claude-thing: npm --prefix daemon run uninstall-hooks), then run this again.');
  process.exit(1);
}

const backup = `${CLAUDE_SETTINGS}.dashd-backup-${Date.now()}`;
if (fs.existsSync(CLAUDE_SETTINGS)) fs.copyFileSync(CLAUDE_SETTINGS, backup);

settings.hooks = settings.hooks || {};
for (const [event, entry] of Object.entries(EVENTS)) {
  const list = settings.hooks[event] = settings.hooks[event] || [];
  // remove any previous dashd entry, then add
  settings.hooks[event] = list.filter((e) => !JSON.stringify(e).includes(`:${PORT}/hook`));
  settings.hooks[event].push(entry);
}
// sweep stale dashd entries from events we no longer register
for (const event of Object.keys(settings.hooks)) {
  if (!EVENTS[event]) {
    settings.hooks[event] = settings.hooks[event].filter(
      (e) => !JSON.stringify(e).includes(`:${PORT}/hook`)
    );
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
}

const others = settings.hooks.PermissionRequest.length - 1;
fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
console.log(`hooks installed into ${CLAUDE_SETTINGS}`);
console.log(`backup: ${backup}`);
if (others > 0) console.log(`warning: ${others} other PermissionRequest hook(s) present — they run alongside dashd's`);
console.log('note: hooks apply to Claude Code sessions started from now on.');
