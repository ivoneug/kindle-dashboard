import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readPermissionContext } from '../../src/codex/permissions.js';

function fixture(t, reviewer = 'auto_review') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-permission-context-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, 'sessions'));
  const file = path.join(home, 'sessions/rollout.jsonl');
  const meta = { type: 'session_meta', payload: { id: 'session' } };
  const context = { type: 'turn_context', payload: { turn_id: 'turn', approvals_reviewer: reviewer } };
  fs.writeFileSync(file, JSON.stringify(meta) + '\n' + JSON.stringify(context) + '\n');
  const hook = { session_id: 'session', turn_id: 'turn', transcript_path: file, hook_event_name: 'PermissionRequest',
    tool_name: 'Bash', tool_input: { command: 'date' } };
  return { home, file, hook, meta, context };
}

test('reviewer belongs to the exact session and latest turn, not to global config', (t) => {
  const { home, hook, file } = fixture(t, 'user');
  fs.writeFileSync(path.join(home, 'config.toml'), 'approvals_reviewer = "auto_review"\n');
  assert.deepEqual(readPermissionContext(hook, { home }), { reviewer: 'user', turnId: 'turn' });
  for (const mismatch of [{ session_id: 'other' }, { turn_id: 'new' }, { turn_id: undefined }]) {
    assert.equal(readPermissionContext({ ...hook, ...mismatch }, { home }), null);
  }
  fs.appendFileSync(file, JSON.stringify({ type: 'turn_context', payload: { turn_id: 'new', approvals_reviewer: 'auto_review' } }) + '\n');
  assert.equal(readPermissionContext(hook, { home }), null, 'do not search behind a newer turn');
  assert.equal(readPermissionContext({ ...hook, turn_id: 'new' }, { home }).reviewer, 'auto_review');
});

test('missing, partial and unknown contexts leave the request to Codex', (t) => {
  const { home, hook, file } = fixture(t, 'user');
  fs.appendFileSync(file, '{"type":"turn_context"');
  assert.equal(readPermissionContext(hook, { home }), null);
  for (const data of ['', 'not JSON\n', JSON.stringify({ type: 'turn_context', payload: { turn_id: 'turn' } }) + '\n']) {
    fs.writeFileSync(file, data);
    assert.equal(readPermissionContext(hook, { home }), null);
  }
  fs.rmSync(file);
  assert.equal(readPermissionContext(hook, { home }), null);
});

test('permissions switched mid-turn use the latest applied settings, without waiting for a new turn', (t) => {
  const { home, hook, file } = fixture(t, 'user');
  const settings = (reviewer) => ({ type: 'event_msg', payload: { type: 'thread_settings_applied',
    thread_id: hook.session_id, thread_settings: { approvals_reviewer: reviewer } } });
  for (const reviewer of ['auto_review', 'user', 'auto_review']) {
    fs.appendFileSync(file, JSON.stringify(settings(reviewer)) + '\n');
    assert.equal(readPermissionContext(hook, { home }).reviewer, reviewer);
  }
  fs.appendFileSync(file, JSON.stringify(settings('future-reviewer')) + '\n');
  assert.equal(readPermissionContext(hook, { home }), null, 'unknown latest settings cannot reuse a manual context');
});

test('applied settings are scoped to the matching chat and do not override the next turn', (t) => {
  const { home, hook, file } = fixture(t, 'auto_review');
  fs.appendFileSync(file, JSON.stringify({ type: 'event_msg', payload: { type: 'thread_settings_applied',
    thread_id: hook.session_id, thread_settings: { approvals_reviewer: 'user' } } }) + '\n');
  fs.appendFileSync(file, JSON.stringify({ type: 'turn_context', payload: { turn_id: 'new', approvals_reviewer: 'auto_review' } }) + '\n');
  assert.equal(readPermissionContext({ ...hook, turn_id: 'new' }, { home }).reviewer, 'auto_review');
  fs.appendFileSync(file, JSON.stringify({ type: 'event_msg', payload: { type: 'thread_settings_applied',
    thread_id: 'other-chat', thread_settings: { approvals_reviewer: 'user' } } }) + '\n');
  assert.equal(readPermissionContext({ ...hook, turn_id: 'new' }, { home }), null);
});

test('context cannot be read from outside the Codex history, including symlinks', (t) => {
  const { home, hook, file } = fixture(t);
  const outside = path.join(home, 'outside.jsonl'); fs.renameSync(file, outside);
  assert.equal(readPermissionContext({ ...hook, transcript_path: outside }, { home }), null);
  fs.symlinkSync(outside, file);
  assert.equal(readPermissionContext(hook, { home }), null);
});

test('bounded history reads do not reuse a manual context older than the tail', (t) => {
  const { home, hook, file } = fixture(t, 'user');
  fs.appendFileSync(file, JSON.stringify({ type: 'response_item', payload: { text: 'x'.repeat(4 * 1024 * 1024) } }) + '\n');
  assert.equal(readPermissionContext(hook, { home }), null);
});

async function runHook(hook, home, port) {
  const script = fileURLToPath(new URL('../../scripts/codex-hook.js', import.meta.url));
  const child = spawn(process.execPath, [script, '--port', String(port)], {
    env: { ...process.env, CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '', err = '';
  child.stdout.on('data', (b) => { out += b; }); child.stderr.on('data', (b) => { err += b; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
  child.stdin.end(JSON.stringify(hook));
  const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
  clearTimeout(timer);
  assert.equal(code, 0, err);
  return JSON.parse(out);
}

test('command hook bypasses even an older holding daemon for Auto, but forwards manual requests', async (t) => {
  const { home, hook, file, meta, context } = fixture(t);
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls++; req.resume(); res.end('{"hookSpecificOutput":{"decision":{"behavior":"allow"}}}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  assert.deepEqual(await runHook(hook, home, port), {});
  assert.deepEqual(await runHook({ ...hook, turn_id: 'not-persisted' }, home, port), {});
  assert.equal(calls, 0, 'Auto does not contact a daemon that might hold it');
  context.payload.approvals_reviewer = 'user';
  fs.writeFileSync(file, JSON.stringify(meta) + '\n' + JSON.stringify(context) + '\n');
  const result = await runHook(hook, home, port);
  assert.equal(result.hookSpecificOutput.decision.behavior, 'allow');
  assert.equal(calls, 1);
  fs.appendFileSync(file, JSON.stringify({ type: 'event_msg', payload: { type: 'thread_settings_applied',
    thread_id: hook.session_id, thread_settings: { approvals_reviewer: 'auto_review' } } }) + '\n');
  assert.deepEqual(await runHook(hook, home, port), {});
  assert.equal(calls, 1, 'a mid-turn switch to Auto must also bypass the daemon');
});
