import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createDesktopPermissions } from '../../src/codex/permissions.js';
import { createStore } from '../../src/claude/sessions/store.js';

const approval = (id = 12, command = 'date') => ({ id, method: 'item/commandExecution/requestApproval',
  params: { threadId: 'chat', turnId: 'turn', itemId: 'item', command, reason: 'Check local state' } });
function fixture(t, requests = [approval()], send) {
  const store = createStore(); store.touch('chat', { name: 'Test chat' });
  const state = { id: 'chat', requests, turns: [], threadRuntimeStatus: { type: 'active' } };
  const events = new EventEmitter(), changes = [], sent = [];
  let closed = 0;
  const observer = { state, events, close() { closed++; }, async answerApproval(request, decision) {
    sent.push({ request, decision }); if (send) await send(request, decision);
  } };
  const control = { async openThread() { return observer; } };
  const permissions = createDesktopPermissions({ control, store, emit: (topic, data) => changes.push({ topic, data }) });
  t.after(() => permissions.stop());
  return { permissions, control, state, store, sent, changes, events, update: () => events.emit('state', state), closed: () => closed };
}

test('native approvals are mirrored without consuming the app request; host answers remove the card', async (t) => {
  const f = fixture(t); await f.permissions.watch('chat');
  const [ask] = f.permissions.list();
  assert.equal(ask.summary, 'date'); assert.equal(ask.sessionName, 'Test chat');
  assert.equal(f.store.get('chat').pendingPermission, true);
  assert.equal(f.state.requests.length, 1); assert.equal(f.sent.length, 0);
  f.update(); assert.equal(f.permissions.list()[0].id, ask.id);
  assert.equal(f.changes.filter((e) => e.topic.endsWith('.request')).length, 1);
  f.state.requests = []; f.update();
  assert.equal(f.permissions.list().length, 0);
  assert.equal(f.store.get('chat').pendingPermission, false);
  assert.equal(await f.permissions.answer(ask.id, 'allow'), false);
  assert.equal(f.sent.length, 0);
});

test('Auto activity without a native human request never creates a Kindle approval', async (t) => {
  const f = fixture(t, []);
  f.state.latestThreadSettings = { approvalsReviewer: 'user' };
  f.state.turns = [{ turnId: 'turn', items: [{ type: 'automaticApprovalReview', status: 'inProgress' }] }];
  await f.permissions.watch('chat');
  assert.equal(f.permissions.list().length, 0);
  assert.equal(f.changes.length, 0); assert.equal(f.sent.length, 0);
});

test('Kindle Y/N answers the native request once, with its exact ID and per-call decision', async (t) => {
  for (const [input, decision] of [['allow', 'accept'], ['deny', 'decline']]) {
    let finish;
    const f = fixture(t, [approval()], () => new Promise((r) => { finish = r; }));
    await f.permissions.watch('chat');
    const ask = f.permissions.list()[0];
    const pending = f.permissions.answer(ask.id, input);
    assert.equal(await f.permissions.answer(ask.id, input), false);
    assert.equal(f.permissions.list().length, 0);
    finish(); assert.equal(await pending, true);
    assert.deepEqual(f.sent, [{ request: approval(), decision }]);
    assert.equal(f.state.requests.length, 1, 'only the owner may resolve its request');
    f.update(); assert.equal(f.permissions.list().length, 0, 'an ack before a state update cannot repeat the answer');
    f.state.requests = []; f.update(); assert.equal(f.permissions.pendingCount(), 0);
  }
});

test('Back dismisses only the Kindle card and leaves the app request and attention intact', async (t) => {
  const f = fixture(t); await f.permissions.watch('chat');
  assert.equal(await f.permissions.answer(f.permissions.list()[0].id, 'ask'), true);
  f.update(); assert.equal(f.permissions.list().length, 0);
  assert.equal(f.store.get('chat').pendingPermission, true);
  assert.equal(f.state.requests.length, 1); assert.equal(f.sent.length, 0);
  f.state.requests = []; f.update(); assert.equal(f.store.get('chat').pendingPermission, false);
});

test('mutated, replaced or resolved requests cannot be answered from an old frame', async (t) => {
  const f = fixture(t); await f.permissions.watch('chat');
  const ask = f.permissions.list()[0];
  f.state.requests[0].params.command = 'rm -rf output';
  assert.equal(await f.permissions.answer(ask.id, 'allow'), false, 'check live state even before its callback');
  const next = f.permissions.list()[0]; assert.notEqual(next.id, ask.id); assert.equal(next.destructive, true);
  f.state.requests = []; // no callback yet
  assert.equal(await f.permissions.answer(next.id, 'allow'), false);
  assert.equal(f.sent.length, 0);
});

test('disconnect and shutdown clear cards without answering, and reconnection invalidates old IDs', async (t) => {
  const f = fixture(t); await f.permissions.watch('chat'); const old = f.permissions.list()[0].id;
  f.events.emit('disconnect', new Error('lost'));
  assert.equal(f.permissions.list().length, 0); assert.equal(f.store.get('chat').pendingPermission, false);
  await f.permissions.watch('chat'); assert.notEqual(f.permissions.list()[0].id, old);
  assert.equal(await f.permissions.answer(old, 'allow'), false);
  f.permissions.stop(); assert.equal(f.permissions.list().length, 0);
  assert.equal(f.sent.length, 0); assert.equal(f.state.requests.length, 1);
  assert.equal(f.closed(), 2);
});

test('an uncertain send is not retried and remains answerable on the host', async (t) => {
  const f = fixture(t, [approval()], () => { throw new Error('ack timed out'); });
  await f.permissions.watch('chat'); const id = f.permissions.list()[0].id;
  await assert.rejects(f.permissions.answer(id, 'allow'), /timed out/);
  f.update(); assert.equal(await f.permissions.answer(id, 'allow'), false);
  assert.equal(f.sent.length, 1); assert.equal(f.state.requests.length, 1);
});

test('unsupported, completed, foreign and underspecified approvals stay in the app', async (t) => {
  const requests = [
    { ...approval(), method: 'item/permissions/requestApproval' },
    { ...approval(), completed: true },
    { ...approval(), params: { ...approval().params, threadId: 'other' } },
    { ...approval(), params: { ...approval().params, command: null } },
    { ...approval(), params: { ...approval().params, availableDecisions: ['acceptForSession', 'decline'] } },
    { ...approval(), method: 'item/fileChange/requestApproval' },
  ];
  const f = fixture(t, requests); await f.permissions.watch('chat');
  assert.equal(f.permissions.list().length, 0); assert.equal(f.sent.length, 0);
});

test('destructive detection uses the full command and file deletion uses the matching turn', async (t) => {
  const file = { ...approval('file'), method: 'item/fileChange/requestApproval' };
  const f = fixture(t, [approval(12, 'echo ' + 'x'.repeat(220) + '; rm -rf output'), file]);
  f.state.turnHistory = { history: { entitiesByKey: { turn: { turnId: 'turn', items: [
    { id: 'item', type: 'fileChange', changes: [{ path: '/tmp/output', kind: { type: 'delete' } }] },
  ] } } } };
  await f.permissions.watch('chat'); const asks = f.permissions.list();
  assert.equal(asks.length, 2); assert.ok(asks.every((a) => a.destructive));
  assert.equal(asks[0].summary.length, 200); assert.equal(asks[1].summary, '/tmp/output');
  await f.permissions.answer(asks[1].id, 'deny'); assert.equal(f.sent[0].request.id, 'file');
});

test('a stopped observer cannot publish after a delayed connection; a missing owner can be retried', async (t) => {
  const f = fixture(t); let resolve;
  const original = f.control.openThread;
  f.control.openThread = () => new Promise((r) => { resolve = r; });
  const watching = f.permissions.watch('chat'); f.permissions.stop();
  resolve(await original()); await watching;
  assert.equal(f.closed(), 1); assert.equal(f.permissions.list().length, 0);
  const retry = fixture(t); retry.control.openThread = async () => { throw new Error('no owner'); };
  await retry.permissions.watch('chat'); assert.equal(retry.permissions.list().length, 0);
  retry.control.openThread = original; await retry.permissions.watch('chat'); assert.equal(retry.permissions.list().length, 1);
});

async function runHook(hook, port) {
  const script = fileURLToPath(new URL('../../scripts/codex-hook.js', import.meta.url));
  const child = spawn(process.execPath, [script, '--port', String(port)], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', (b) => { out += b; }); child.stderr.on('data', (b) => { err += b; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
  child.stdin.end(JSON.stringify(hook));
  const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
  clearTimeout(timer); assert.equal(code, 0, err); return JSON.parse(out);
}

test('legacy PermissionRequest hook always bypasses an older holding daemon; activity still forwards', async (t) => {
  let calls = 0;
  const server = http.createServer((req, res) => { calls++; req.resume(); res.end('{}'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  for (const reviewer of ['user', 'auto_review', undefined]) {
    assert.deepEqual(await runHook({ hook_event_name: 'PermissionRequest', approvals_reviewer: reviewer,
      session_id: 'chat', turn_id: 'turn', tool_name: 'Bash', tool_input: { command: 'date' } }, port), {});
  }
  assert.equal(calls, 0);
  assert.deepEqual(await runHook({ hook_event_name: 'PreToolUse', session_id: 'chat' }, port), {});
  assert.equal(calls, 1);
});
