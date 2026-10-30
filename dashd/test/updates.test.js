import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createSlackUpdates } from '../src/slack/updates.js';
import { createSlack } from '../src/slack/index.js';
import { createSessionUpdates } from '../src/session-updates.js';
import { createHandler } from '../src/http-server.js';
import { createFrameStore } from '../src/frames.js';

const ts = (n) => '1793350000.' + String(n).padStart(6, '0');
const m = (n, replyCount = 0, latest = n) => ({ id: ts(n), text: 'private message body', replyCount, latestReply: replyCount ? ts(latest) : null });
const raw = (n, replyCount = 0, latest = n) => ({ type: 'message', ts: ts(n), text: 'post ' + n, reply_count: replyCount, latest_reply: replyCount ? ts(latest) : null });

test('initial history is a quiet baseline; a new post and new replies become unread exactly once', () => {
  const u = createSlackUpdates(); u.observe([m(5), m(1, 1, 3)]); assert.equal(u.unreadCount, 0);
  u.observe([m(6)]); assert.equal(u.forMessage(m(6)).unreadCount, 1);
  u.observe([m(1, 3, 8)]); assert.equal(u.forMessage(m(1, 3, 8)).unreadCount, 2); assert.equal(u.unreadCount, 3);
  u.observe([m(1, 3, 8), m(6)]); assert.equal(u.unreadCount, 3);
});

test('acknowledging the displayed snapshot leaves replies arriving during rendering unread', () => {
  const u = createSlackUpdates(); u.observe([m(1, 1, 2)]); u.observe([m(1, 3, 5)]);
  assert.equal(u.acknowledge({ id: ts(1), latestTs: ts(4), replyCount: 2 }), true);
  assert.equal(u.unreadCount, 1);
  assert.equal(u.acknowledge({ id: ts(1), latestTs: ts(4), replyCount: 2 }), false);
  assert.equal(u.acknowledge({ id: ts(1), latestTs: ts(2), replyCount: 1 }), false);
  u.acknowledge({ id: ts(1), latestTs: ts(5), replyCount: 3 }); assert.equal(u.unreadCount, 0);
});

test('unread state survives restart, stores no message text and is scoped to the channel', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-read-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'read.json');
  const first = createSlackUpdates({ file, channelId: 'C1' }); first.observe([m(1)]); first.observe([m(2), m(1, 2, 4)]);
  const restored = createSlackUpdates({ file, channelId: 'C1' }); assert.equal(restored.unreadCount, 3);
  restored.observe([m(2), m(1, 2, 4)]); assert.equal(restored.unreadCount, 3);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('private message body'));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const other = createSlackUpdates({ file, channelId: 'C2' }); other.observe([m(8)]); assert.equal(other.unreadCount, 0);
});

test('loading old history does not create notifications; deleting an unread post clears its notification', () => {
  const u = createSlackUpdates(); u.observe([m(5)]); u.observe([m(1, 1, 3)]); assert.equal(u.unreadCount, 0);
  u.observe([m(6)]); assert.equal(u.unreadCount, 1); u.remove([ts(6)]); assert.equal(u.unreadCount, 0);
});

test('a newer reply still notifies when a deletion kept the total reply count unchanged', () => {
  const u = createSlackUpdates(); u.observe([m(1, 2, 3)]); u.observe([m(1, 2, 4)]); assert.equal(u.unreadCount, 1);
});

test('initial unread messages use the Slack read position instead of silently reading the whole history', () => {
  const u = createSlackUpdates(); u.initializeReadPosition(ts(3));
  u.observe([m(5), m(2), m(1, 2, 4)]);
  assert.equal(u.forMessage(m(5)).unreadCount, 1);
  assert.equal(u.forMessage(m(2)).unreadCount, 0);
  assert.equal(u.forMessage(m(1, 2, 4)).unreadCount, 1);
  assert.equal(u.unreadCount, 2);
  u.acknowledge({ id: ts(5), latestTs: ts(5), replyCount: 0 });
  u.initializeReadPosition(ts(1));
  assert.equal(u.forMessage(m(5)).unreadCount, 0, 'later Slack read positions cannot undo a local read');
});

test('legacy bootstrap migration recovers unread Slack posts and preserves later explicit Kindle reads', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-read-migration-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'read.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, channelId: 'C1', baseline: ts(5), entries: {
    [ts(5)]: { seenTs: ts(5), latestTs: ts(5), seenReplyCount: 0, replyCount: 0 },
    [ts(1)]: { seenTs: ts(3), latestTs: ts(3), seenReplyCount: 2, replyCount: 2 },
    [ts(6)]: { seenTs: ts(7), latestTs: ts(7), seenReplyCount: 1, replyCount: 1 },
  } }), { mode: 0o600 });
  const u = createSlackUpdates({ file, channelId: 'C1' });
  assert.equal(u.needsReadPosition, true); u.initializeReadPosition(ts(4));
  assert.equal(u.forMessage(m(5)).unreadCount, 1);
  assert.equal(u.forMessage(m(1, 2, 3)).unreadCount, 0);
  assert.equal(u.forMessage(m(6, 1, 7)).unreadCount, 0);
  const restored = createSlackUpdates({ file, channelId: 'C1' });
  assert.equal(restored.needsReadPosition, false); assert.equal(restored.unreadCount, 1);
  restored.acknowledge({ id: ts(5), latestTs: ts(5), replyCount: 0 });
  assert.equal(createSlackUpdates({ file, channelId: 'C1' }).unreadCount, 0);
});

test('temporarily unavailable Slack read position retries without blocking history or undoing Kindle reads', async (t) => {
  let time = 100, attempts = 0;
  const s = createSlack({ token: 'fake', channelId: 'C1', autoStart: false, now: () => time, api: async (method) => {
    if (method === 'conversations.info') {
      if (++attempts === 1) throw Object.assign(new Error('connection_failed'), { retryMs: 20_000 });
      return { channel: { last_read: ts(3) } };
    }
    return { messages: [raw(5), raw(4), raw(2)] };
  } }); t.after(() => s.stop());
  await s.poll(); assert.equal(s.state.messages.length, 3); assert.equal(s.state.error, '');
  s.acknowledge({ id: ts(5), latestTs: ts(5), replyCount: 0 });
  time += 10_000; await s.poll(); assert.equal(attempts, 1);
  time += 10_000; await s.poll(); assert.equal(attempts, 2);
  assert.equal(s.state.unreadCount, 1);
  assert.equal(s.state.messages.find((m) => m.id === ts(4)).unreadCount, 1);
  assert.equal(s.state.messages.find((m) => m.id === ts(5)).unreadCount, 0);
  await s.poll(); assert.equal(attempts, 2);
});

test('saved local reads survive restart without fetching or following Slack read markers again', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-read-bootstrap-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'read.json'); let infoCalls = 0;
  const api = async (method) => {
    if (method === 'conversations.info') { infoCalls++; return { channel: { last_read: ts(3) } }; }
    return { messages: [raw(5), raw(4), raw(2)] };
  };
  const options = { token: 'fake', channelId: 'C1', autoStart: false, updatesFile: file, api };
  const first = createSlack(options); t.after(() => first.stop());
  await first.poll(); assert.equal(first.state.unreadCount, 2);
  first.acknowledge({ id: ts(5), latestTs: ts(5), replyCount: 0 }); first.stop();
  const restarted = createSlack(options); t.after(() => restarted.stop());
  await restarted.poll(); assert.equal(infoCalls, 1); assert.equal(restarted.state.unreadCount, 1);
  assert.equal(restarted.state.messages.find((m) => m.id === ts(5)).unreadCount, 0);
});

test('tokens without a Slack read marker retain a quiet history baseline and detect subsequent posts', () => {
  const u = createSlackUpdates(); u.initializeReadPosition(undefined); u.observe([m(5), m(1, 1, 3)]);
  assert.equal(u.needsReadPosition, false); assert.equal(u.unreadCount, 0);
  u.observe([m(6)]); assert.equal(u.unreadCount, 1);
});

test('session notification tracks visible changes while active, ignores poll timestamps and clears when all sessions are quiet', () => {
  const u = createSessionUpdates(), busy = [{ id: 'a', name: 'Chat', state: 'busy', context: .2 }];
  u.update(busy, { a: { activity: 'Read file', activityTs: 1 } }); const shown = u.revision; assert.equal(u.pending, false);
  u.update(busy, { a: { activity: 'Read file', activityTs: 2 } }); assert.equal(u.pending, false);
  u.update(busy, { a: { activity: 'Write file' } }); assert.equal(u.pending, true);
  u.acknowledge(shown); assert.equal(u.pending, true, 'an older displayed frame must not clear newer content');
  u.acknowledge(u.revision); assert.equal(u.pending, false);
  u.update(busy, { a: { activity: 'Read file' } }); assert.equal(u.pending, true, 'returning to an earlier activity is still a new change');
  u.acknowledge(u.revision); u.acknowledge(shown); assert.equal(u.pending, false, 'an older acknowledgement cannot move the read position backwards');
  u.update([{ ...busy[0], context: .3 }]); assert.equal(u.pending, true);
  u.update([{ ...busy[0], state: 'idle' }]); assert.equal(u.pending, false);
  u.update([{ ...busy[0], state: 'attention' }]); assert.equal(u.pending, true);
});

test('thread updates reorder old posts by activity, preserve unread until acknowledgement, and choose singular/plural counts', async (t) => {
  let phase = 0;
  const s = createSlack({ token: 'fake', channelId: 'C1', autoStart: false, api: async (method) => {
    if (method === 'conversations.replies') return { messages: [raw(1, 2, 8), raw(7), raw(8)] };
    return { messages: phase === 0 ? [raw(5), raw(1)] : [raw(6), raw(5), raw(1, 2, 8)] };
  } }); t.after(() => s.stop());
  await s.poll(); assert.equal(s.state.unreadCount, 0); phase = 1; await s.poll();
  assert.deepEqual(s.state.messages.map((m) => m.id), [ts(1), ts(6), ts(5)]);
  assert.equal(s.state.messages[0].unreadCount, 2); assert.equal(s.state.messages[1].unreadCount, 1);
  await s.loadThread(ts(1)); assert.equal(s.state.unreadCount, 3, 'opening or fetching alone is not reading');
  s.acknowledge({ id: ts(1), latestTs: ts(8), replyCount: 2 }); assert.equal(s.state.unreadCount, 1);
});

test('older loaded history is refreshed for new replies outside the newest API page', async (t) => {
  let updated = false;
  const s = createSlack({ token: 'fake', channelId: 'C1', autoStart: false, api: async (_, args) => {
    if (args.cursor) return { messages: [raw(1)] };
    if (args.latest) return { messages: [raw(7), raw(1, updated ? 2 : 0, 10)] };
    return { messages: [raw(8), raw(7)], response_metadata: { next_cursor: 'older' } };
  } }); t.after(() => s.stop());
  await s.poll(); await s.loadMore(); assert.equal(s.state.unreadCount, 0);
  updated = true; await s.poll(); assert.equal(s.state.messages[0].id, ts(1)); assert.equal(s.state.messages[0].unreadCount, 2);
});

test('only authenticated Kindle polls with the current epoch acknowledge actually displayed frame metadata', async () => {
  const frames = createFrameStore(), shown = [], token = 'a'.repeat(64);
  frames.publish(Buffer.from('png'), { meta: { slackRead: { id: ts(1), latestTs: ts(3), replyCount: 2 } } });
  const handler = createHandler({ frames, deviceToken: token, longPollMs: 1, onShown: (frame) => shown.push(frame.meta) });
  async function request(query, address = '192.168.1.147') {
    const req = new EventEmitter(); Object.assign(req, { method: 'GET', url: '/version?' + query, socket: { remoteAddress: address } });
    const res = new EventEmitter(); res.writeHead = () => {}; res.end = () => {}; await handler(req, res);
  }
  await request('since=1&epoch=' + frames.epoch); assert.equal(shown.length, 0);
  await request('since=1&epoch=previous&token=' + token); assert.equal(shown.length, 0);
  await request('since=1&token=' + token); assert.equal(shown.length, 0);
  await request('since=1&epoch=' + frames.epoch, '127.0.0.1'); assert.equal(shown.length, 0);
  await request('since=99&epoch=' + frames.epoch + '&token=' + token); assert.equal(shown.length, 0);
  await request('since=1&epoch=' + frames.epoch + '&token=' + token); assert.equal(shown.length, 1);
  assert.deepEqual(shown[0].slackRead, { id: ts(1), latestTs: ts(3), replyCount: 2 });
});

test('restart restores an unread old thread to the list even when its root is outside the newest history page', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-unread-root-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'read.json'), u = createSlackUpdates({ file, channelId: 'C1' });
  u.observe([m(1), m(5)]); u.observe([m(1, 2, 8)]);
  const s = createSlack({ token: 'fake', channelId: 'C1', autoStart: false, updatesFile: file, api: async (method, args) => {
    if (method === 'conversations.replies') { assert.equal(args.ts, ts(1)); return { messages: [raw(1, 2, 8)] }; }
    return { messages: [raw(5)] };
  } }); t.after(() => s.stop());
  assert.equal(s.state.unreadCount, 2); await s.poll();
  assert.equal(s.state.messages[0].id, ts(1)); assert.equal(s.state.messages[0].unreadCount, 2);
});
