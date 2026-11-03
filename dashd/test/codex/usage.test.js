import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeUsage } from '../../src/codex/usage.js';
import { createCodex } from '../../src/codex/index.js';
import { renderUsage } from '../../src/screens/usage.js';

const now = Date.parse('2026-11-03T13:00:00Z');
const credit = (extra = {}) => ({ id: 'reset-1', status: 'available', title: 'Full reset',
  description: 'One free rate limit reset.', expiresAt: now / 1000 + 3600, ...extra });
const reading = (credits = [credit()], availableCount = credits?.length ?? 2) => ({
  rateLimits: { primary: { usedPercent: 23, windowDurationMins: 10080 } },
  rateLimitResetCredits: { availableCount, credits },
});
const render = (usage) => renderUsage({ usage, now, orientation: 'portrait' }, { width: 600, height: 800 });

test('earned resets retain the authoritative count and only available details', () => {
  const u = normalizeUsage(reading([credit(), credit({ id: 'used', status: 'redeemed' })], 4), now);
  assert.equal(u.resetCredits.availableCount, 4);
  assert.deepEqual(u.resetCredits.credits, [{ id: 'reset-1', title: 'Full reset',
    description: 'One free rate limit reset.', expiresTs: now + 3600_000 }]);
  const html = render(u);
  assert.match(html, /4 available/);
  assert.match(html, /Full reset/);
  assert.match(html, /Expires /);
  assert.match(html, /\+3 more available/);
  assert.equal(normalizeUsage({}).resetCredits, null);
});

test('count-only resets render even without usage windows; absent and empty resets stay hidden', () => {
  for (const credits of [null, []]) {
    const r = reading(credits, 2); delete r.rateLimits;
    const html = render(normalizeUsage(r, now));
    assert.match(html, /2 available/);
    assert.match(html, /Available to use in Codex/);
    assert.doesNotMatch(html, /class="empty"/);
  }
  for (const r of [{}, reading([], 0)]) {
    assert.doesNotMatch(render(normalizeUsage(r, now)), /<section class="uresets">/);
  }
});

test('reset cards escape service text, omit expired credits and handle no expiry', () => {
  const html = render(normalizeUsage(reading([
    credit({ title: '<img src=x>', description: '<script>alert(1)</script>', expiresAt: null }),
    credit({ id: 'expired', title: 'Expired reset', expiresAt: now / 1000 }),
  ]), now));
  assert.match(html, /1 available/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /No expiry/);
  assert.doesNotMatch(html, /<img|<script|Expired reset/);
  assert.doesNotMatch(render(normalizeUsage(reading([credit({ expiresAt: now / 1000 - 1 })]), now)),
    /<section class="uresets">/);
});

test('rollout usage preserves earned resets and cannot postpone their account refresh', { timeout: 5000 }, async (t) => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-usage-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, 'sessions'));
  const file = path.join(home, 'sessions/rollout.jsonl');
  let clock = now, reads = 0, notify;
  t.mock.method(Date, 'now', () => clock);
  const agent = createCodex({ home, pollMs: 5,
    permissionControl: { async openThread() { throw new Error('Not open'); } },
    rpc: { async request(method) { return method === 'account/rateLimits/read'
      ? (++reads === 1 ? reading() : reading([], 0)) : { data: [] }; }, stop() {} },
    onChange(topic) { if (topic === 'codex.usage.update') notify?.(); },
  });
  t.after(() => agent.stop());
  const nextPoll = () => new Promise((resolve) => { notify = resolve; });
  await nextPoll();
  assert.equal(reads, 1);
  clock += 61_000;
  fs.writeFileSync(file, JSON.stringify({ type: 'event_msg', timestamp: new Date(clock).toISOString(),
    payload: { type: 'token_count', rate_limits: { primary: { used_percent: 31, window_minutes: 10080 } } } }) + '\n');
  agent.onHook('PostToolUse', { session_id: 'chat', transcript_path: file }, { writeHead() {}, end() {} });
  assert.equal(agent.state.usage.limits[0].used, 0.31);
  assert.equal(agent.state.usage.resetCredits.availableCount, 1);
  await nextPoll();
  assert.equal(reads, 2, 'fresh rollout usage does not defer the account read');
  assert.equal(agent.state.usage.resetCredits.availableCount, 0, 'consumed credits disappear after refresh');
});
