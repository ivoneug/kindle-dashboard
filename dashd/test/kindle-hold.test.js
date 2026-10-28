// The Kindle's changes to claude-thing's permission bridge: no hold without a
// Kindle, Back as an "ask" decision, and handing everything back when the
// Kindle drops off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPermissionBridge } from '../src/claude/permission-bridge.js';
import { createStore } from '../src/claude/sessions/store.js';

function fakeRes() {
  return {
    body: null,
    writeHead() {},
    end(body) { this.body = body; },
    on() {},
  };
}

const decisionOf = (res) => JSON.parse(res.body).hookSpecificOutput.decision.behavior;
const HOOK = { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } };

function setup(attached) {
  const events = [];
  const bridge = createPermissionBridge({
    emit: (topic, data) => events.push({ topic, data }),
    store: createStore(),
    queue: null,
    shouldHold: () => attached.value,
  });
  return { bridge, events };
}

test('no Kindle attached: the request goes to the terminal at once, nothing is held', () => {
  const { bridge, events } = setup({ value: false });
  const res = fakeRes();
  bridge.onHookRequest(HOOK, res);
  assert.equal(decisionOf(res), 'ask');
  assert.equal(bridge.pendingCount(), 0);
  assert.equal(events.length, 0);
});

test('Kindle attached: the request is held until answered', () => {
  const { bridge } = setup({ value: true });
  const res = fakeRes();
  bridge.onHookRequest(HOOK, res);
  assert.equal(res.body, null);
  assert.equal(bridge.pendingCount(), 1);
  assert.ok(bridge.answer(bridge.list()[0].id, 'allow'));
  assert.equal(decisionOf(res), 'allow');
});

test('Back answers "ask": the prompt moves to the terminal', () => {
  const { bridge, events } = setup({ value: true });
  const res = fakeRes();
  bridge.onHookRequest(HOOK, res);
  const id = bridge.list()[0].id;
  assert.ok(bridge.answer(id, 'ask'));
  assert.equal(decisionOf(res), 'ask');
  assert.deepEqual(events.at(-1), { topic: 'claude.permission.resolved', data: { requestId: id, resolution: 'ask' } });
});

test('the Kindle dropping off hands every held request back', () => {
  const attached = { value: true };
  const { bridge } = setup(attached);
  const a = fakeRes();
  const b = fakeRes();
  bridge.onHookRequest(HOOK, a);
  bridge.onHookRequest({ ...HOOK, session_id: 's2' }, b);
  attached.value = false;
  assert.equal(bridge.releaseAll('unlinked'), 2);
  assert.equal(decisionOf(a), 'ask');
  assert.equal(decisionOf(b), 'ask');
  assert.equal(bridge.pendingCount(), 0);
});
