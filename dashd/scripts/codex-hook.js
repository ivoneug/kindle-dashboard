#!/usr/bin/env node
// Activity hooks: stdin JSON → dashd on loopback. Legacy PermissionRequest
// registrations return immediately, before contacting even an older daemon.
import http from 'node:http';

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
// Native approvals must reach Codex's reviewer and app before we observe them.
if (permission) {
  process.stdout.write('{}\n');
  process.exit(0);
}
const body = JSON.stringify(Object.fromEntries(['session_id', 'transcript_path', 'cwd', 'hook_event_name',
  'turn_id', 'tool_use_id', 'tool_name', 'tool_input', 'prompt'].filter((k) => k in payload).map((k) => [k, payload[k]])));
await new Promise((resolve) => {
  let done = false;
  const finish = (s = '{}') => { if (!done) { done = true; clearTimeout(timer); resolve(s); } };
  const req = http.request({ hostname: '127.0.0.1', port, path: '/codex/hook', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
    let text = '';
    res.on('data', (b) => { text += b; if (text.length > 64 * 1024) { req.destroy(); finish(); } });
    res.on('end', () => finish(res.statusCode === 200 ? text : '{}'));
    res.on('error', () => finish());
  });
  const timer = setTimeout(() => { req.destroy(); finish(); }, 1500);
  req.on('error', () => finish());
  req.end(body);
});
process.stdout.write('{}\n');
