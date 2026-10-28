// dashd addition: task list and activity line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPlanCall, describeTool } from '../../src/claude/sessions/activity.js';

const P = 'mcp__ccd_turn__update_plan';
const items = [
  { content: 'one', status: 'in_progress' },
  { content: 'two', status: 'pending' },
  { content: 'three', status: 'pending' },
];
const statuses = (plan) => plan.map((p) => p.status[0]).join('');

test('items replace the plan; advance moves to the next step', () => {
  let plan = applyPlanCall(undefined, P, { items });
  assert.equal(statuses(plan), 'ipp');
  plan = applyPlanCall(plan, P, { advance: true });
  assert.equal(statuses(plan), 'cip');
  plan = applyPlanCall(plan, P, { advance: true });
  plan = applyPlanCall(plan, P, { advance: true });
  assert.equal(statuses(plan), 'ccc');
});

test('done and start, 1-based, keep one step in progress', () => {
  let plan = applyPlanCall(undefined, P, { items });
  plan = applyPlanCall(plan, P, { done: [1], start: 3 });
  assert.equal(statuses(plan), 'cpi');
});

test('wrap_up checks everything off; TodoWrite replaces the list', () => {
  let plan = applyPlanCall(undefined, P, { items });
  plan = applyPlanCall(plan, 'mcp__ccd_turn__wrap_up', { recap: 'x' });
  assert.equal(statuses(plan), 'ccc');
  plan = applyPlanCall(plan, 'TodoWrite', { todos: [{ content: 'a', status: 'completed', activeForm: 'A' }, { content: 'b', status: 'in_progress' }] });
  assert.deepEqual(plan, [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }]);
});

test('other tools leave the plan alone', () => {
  assert.equal(applyPlanCall([], 'Bash', { command: 'ls' }), undefined);
  assert.equal(applyPlanCall(undefined, 'mcp__ccd_turn__wrap_up', {}), undefined);
});

test('the activity line prefers the call\'s own description', () => {
  assert.equal(describeTool('Bash', { command: 'npm test', description: 'Run the test suite' }), 'Run the test suite');
  assert.equal(describeTool('Edit', { file_path: '/a/b/index.js' }), 'Edit index.js');
  assert.equal(describeTool('Bash', { command: 'ls -la\nmore' }), 'Bash: ls -la');
  assert.equal(describeTool('mcp__ccd_turn__update_plan', {}), 'update_plan');
  assert.equal(describeTool('mcp__Claude_Browser__preview_start', { name: 'dashd' }), 'preview_start');
});
