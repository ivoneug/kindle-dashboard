import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { applyRecord, createRolloutReader } from '../../src/codex/rollout.js';
import { normalizeUsage } from '../../src/codex/usage.js';
import { codexDecision, createCodex } from '../../src/codex/index.js';
import { sessionName, createTitleIndex } from '../../src/codex/titles.js';
import { mergeCodexHooks } from '../../scripts/codex-hooks-config.js';

const record = (type, payload) => ({ type, timestamp: '2026-10-29T00:00:00Z', payload });

test('real titles take precedence over previews and folder names', () => {
  const titles = new Map([['chat', 'Реализация Kindle Dashboard']]);
  const row = { id: 'chat', preview: 'почитай документ в этой директории', cwd: '/projects/kindle-dashboard' };
  assert.equal(sessionName(row, titles), 'Реализация Kindle Dashboard');
  assert.equal(sessionName({ ...row, name: 'Renamed in Codex' }, titles), 'Renamed in Codex');
  assert.equal(sessionName({ ...row, name: 'Imported session' }, titles), 'Реализация Kindle Dashboard');
  assert.equal(sessionName(row), 'Untitled session');
  assert.equal(sessionName({ name: '<scheduled-task name="tweek-pr-review">body</scheduled-task>' }), 'Untitled session');
});

test('title index restores import titles, follows native renames and tolerates partial writes', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-titles-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, 'external_agent_session_imports.json'), JSON.stringify({ records: [
    { imported_thread_id: 'chat', title: 'Реализация Kindle Dashboard' },
    { imported_thread_id: 'review', title: 'Ревью PR Tweek' },
  ] }));
  const index = createTitleIndex({ home });
  assert.equal(index.read().get('chat'), 'Реализация Kindle Dashboard');
  const file = path.join(home, 'session_index.jsonl');
  fs.writeFileSync(file, JSON.stringify({ id: 'chat', thread_name: 'Native rename' }) + '\n');
  assert.equal(index.read().get('chat'), 'Native rename');
  fs.writeFileSync(file, '{"id":');
  assert.equal(index.read().get('chat'), 'Native rename', 'partial write keeps the last valid index');
  fs.writeFileSync(file, JSON.stringify({ id: 'chat', thread_name: 'A second rename' }) + '\n');
  assert.equal(index.read().get('chat'), 'A second rename');
  assert.equal(index.read().get('review'), 'Ревью PR Tweek');
});

test('Codex lifecycle, plan and tool output become dashboard detail', () => {
  const s = {};
  applyRecord(s, record('event_msg', { type: 'task_started', model_context_window: 200000 }));
  applyRecord(s, record('turn_context', { model: 'a-future-model', effort: 'high', approval_policy: 'on-request' }));
  applyRecord(s, record('response_item', { type: 'function_call', name: 'update_plan', call_id: 'p',
    arguments: JSON.stringify({ plan: [{ step: 'Подключить Kindle', status: 'in_progress' }] }) }));
  assert.deepEqual(s.plan, [{ content: 'Подключить Kindle', status: 'in_progress' }]);
  applyRecord(s, record('response_item', { type: 'function_call', name: 'exec_command', call_id: 'tool',
    arguments: JSON.stringify({ cmd: 'date', description: 'Read the time' }) }));
  assert.equal(s.activity, 'Read the time');
  applyRecord(s, record('response_item', { type: 'function_call_output', call_id: 'other' }));
  assert.equal(s.activity, 'Read the time');
  applyRecord(s, record('response_item', { type: 'function_call_output', call_id: 'tool' }));
  assert.equal(s.activity, null);
  applyRecord(s, record('event_msg', { type: 'task_complete', last_agent_message: '**Готово**' }));
  assert.equal(s.thinking, false);
  assert.equal(s.lastMessage, '**Готово**');
});

test('context uses occupancy from last turn, totals remain lifetime counts', () => {
  const s = {};
  applyRecord(s, record('event_msg', { type: 'token_count', info: { model_context_window: 200000,
    total_token_usage: { input_tokens: 1000000, output_tokens: 50000, cached_input_tokens: 900000 },
    last_token_usage: { input_tokens: 40000, output_tokens: 500, total_tokens: 40500 } } }));
  assert.equal(s.tokensIn, 1000000);
  assert.equal(s.contextTokens / s.contextWindow, 0.2025);
});

test('guardian reviews are excluded and user-side text is not a reply', () => {
  const s = { lastMessage: 'reply' };
  applyRecord(s, record('session_meta', { source: { subagent: { other: 'guardian' } }, thread_source: 'guardian_review' }));
  assert.equal(s.internal, true);
  applyRecord(s, record('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'a reminder' }] }));
  assert.equal(s.lastMessage, 'reply');
});

test('rollout reader survives partial lines and UTF-8 chunk boundaries without replay', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-codex-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'rollout.jsonl');
  const text = 'я'.repeat(40000);
  const json = JSON.stringify(record('event_msg', { type: 'agent_message', message: text }));
  fs.writeFileSync(file, json.slice(0, -1));
  const reader = createRolloutReader(); const got = [];
  reader.read(file, (o) => got.push(o));
  assert.equal(got.length, 0);
  fs.appendFileSync(file, '}\n'); reader.read(file, (o) => got.push(o)); reader.read(file, (o) => got.push(o));
  assert.equal(got.length, 1); assert.equal(got[0].payload.message, text);
});

test('limits accept RPC and rollout schemas, and missing means unavailable', () => {
  const rpc = normalizeUsage({ rateLimitsByLimitId: { codex: { primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 1 } } } });
  assert.equal(rpc.limits[0].used, 0.23);
  assert.match(rpc.limits[0].label, /5 HOURS/);
  assert.equal(normalizeUsage({ rateLimits: { primary: { used_percent: 75, window_minutes: 10080 } } }).limits[0].used, 0.75);
  assert.equal(normalizeUsage({}).limits.length, 0);
  assert.ok(normalizeUsage({}).error);
});

test('no decision to Codex is {}, never unsupported behavior:ask', () => {
  for (const behavior of ['ask', 'timeout', undefined, 'allowAll']) {
    assert.equal(codexDecision(JSON.stringify({ hookSpecificOutput: { decision: { behavior } } })), '{}');
  }
  for (const behavior of ['allow', 'deny']) {
    assert.equal(JSON.parse(codexDecision(JSON.stringify({ hookSpecificOutput: { decision: { behavior } } }))).hookSpecificOutput.decision.behavior, behavior);
  }
});

test('hook merge is idempotent and preserves unrelated handlers in our group', () => {
  const opts = { node: '/a path/node', script: '/repo/codex-hook.js', port: 8765 };
  const original = { description: 'mine', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo original' }] }] } };
  const one = mergeCodexHooks(original, opts);
  assert.deepEqual(mergeCodexHooks(one, opts), one);
  one.hooks.Stop.at(-1).hooks.push({ type: 'command', command: 'echo keep' });
  const removed = mergeCodexHooks(one, { ...opts, remove: true });
  assert.deepEqual(removed.hooks.Stop.flatMap((g) => g.hooks.map((h) => h.command)), ['echo original', 'echo keep']);
  assert.equal(original.hooks.Stop.length, 1);
});

function response() {
  const r = new EventEmitter(); r.writeHead = () => {}; r.end = (body) => { r.body = body; }; return r;
}
const payload = { session_id: 'test-codex-thread', tool_name: 'Bash', tool_input: { command: 'date' } };

test('real Codex adapter holds and answers allow/deny, Back and disconnect release to host', (t) => {
  const agent = createCodex({ shouldHold: () => true, rpc: { request: async () => ({ data: [] }), stop() {} } });
  t.after(() => agent.stop());
  for (const decision of ['allow', 'deny', 'ask']) {
    const res = response(); agent.onHook('PermissionRequest', payload, res);
    assert.equal(res.body, undefined);
    const ask = agent.asks()[0]; assert.ok(ask);
    assert.equal(agent.answerPermission(ask.id, decision), true);
    assert.equal(decision === 'ask' ? res.body : JSON.parse(res.body).hookSpecificOutput.decision.behavior, decision === 'ask' ? '{}' : decision);
    assert.equal(agent.answerPermission(ask.id, 'allow'), false);
  }
  const res = response(); agent.onHook('PermissionRequest', payload, res);
  agent.releasePermissions('unlinked'); assert.equal(res.body, '{}');
});

test('without Kindle the Codex approval goes to its normal UI immediately', (t) => {
  const agent = createCodex({ shouldHold: () => false, rpc: { request: async () => ({ data: [] }), stop() {} } });
  t.after(() => agent.stop());
  const res = response(); agent.onHook('PermissionRequest', payload, res);
  assert.equal(res.body, '{}'); assert.equal(agent.asks().length, 0);
});

test('Codex questions are visible in Queue and resolved when the tool finishes', (t) => {
  const agent = createCodex({ rpc: { request: async () => ({ data: [] }), stop() {} } });
  t.after(() => agent.stop());
  agent.onHook('PreToolUse', { session_id: 'question-session', turn_id: 'q1', tool_name: 'request_user_input',
    tool_input: { questions: [{ header: 'Layout', question: 'Which screen?', options: [{ label: 'Portrait', description: 'Tall' }] }] } }, response());
  assert.equal(agent.asks()[0].kind, 'question');
  assert.equal(agent.asks()[0].questions[0].options[0].label, 'Portrait');
  agent.onHook('PostToolUse', { session_id: 'question-session', tool_name: 'request_user_input' }, response());
  assert.equal(agent.asks().length, 0);
});

test('Codex hooks are routed to the Codex backend and rejected from the USB peer', async () => {
  const { createHandler } = await import('../../src/http-server.js');
  const calls = [];
  const handler = createHandler({ onHook(event, payload, res, provider) {
    calls.push({ event, provider, id: payload.session_id }); res.writeHead(200); res.end('{}');
  } });
  for (const address of ['127.0.0.1', '192.168.2.2']) {
    const req = new EventEmitter(); Object.assign(req, { method: 'POST', url: '/codex/hook', socket: { remoteAddress: address } });
    const res = response(); res.writeHead = (status) => { res.status = status; };
    const done = handler(req, res);
    req.emit('data', Buffer.from(JSON.stringify({ hook_event_name: 'Stop', session_id: 's' }))); req.emit('end');
    await done;
    assert.equal(res.status, address === '127.0.0.1' ? 200 : 404);
  }
  assert.deepEqual(calls, [{ event: 'Stop', provider: 'codex', id: 's' }]);
});
