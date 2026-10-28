#!/usr/bin/env node
// Codex command hook: stdin JSON → dashd on loopback → stdout JSON. A missing
// dashboard, invalid response, timeout, Back or disconnected Kindle all return
// no decision, leaving Codex's own approval flow in charge.
import http from 'node:http';
import { codexDecision } from '../src/codex/index.js';
import { readPermissionContext } from '../src/codex/permissions.js';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || 8765;
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 4 * 1024 * 1024) { process.stdout.write('{}\n'); process.exit(0); }
}
let payload;
try { payload = JSON.parse(input); } catch { process.stdout.write('{}\n'); process.exit(0); }
const permission = payload.hook_event_name === 'PermissionRequest';
// Also guard here so an already running older daemon cannot hold an Auto
// request while the service is being upgraded/restarted.
if (permission && readPermissionContext(payload)?.reviewer !== 'user') {
  process.stdout.write('{}\n');
  process.exit(0);
}
const body = JSON.stringify(Object.fromEntries(['session_id', 'transcript_path', 'cwd', 'hook_event_name',
  'turn_id', 'tool_use_id', 'tool_name', 'tool_input', 'prompt'].filter((k) => k in payload).map((k) => [k, payload[k]])));
const response = await new Promise((resolve) => {
  let done = false;
  const finish = (s = '{}') => { if (!done) { done = true; clearTimeout(timer); resolve(s); } };
  const req = http.request({ hostname: '127.0.0.1', port, path: '/codex/hook', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
    let text = '';
    res.on('data', (b) => { text += b; if (text.length > 64 * 1024) { req.destroy(); finish(); } });
    res.on('end', () => finish(res.statusCode === 200 ? text : '{}'));
    res.on('error', () => finish());
  });
  const timer = setTimeout(() => { req.destroy(); finish(); }, permission ? 596_000 : 1500);
  req.on('error', () => finish());
  req.end(body);
});
process.stdout.write((permission ? codexDecision(response) : '{}') + '\n');
