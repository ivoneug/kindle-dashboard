import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSlackApi, SlackError } from '../src/slack/api.js';
import { createSlack } from '../src/slack/index.js';
import { normalizeMessage, compareTs, renderSlackText } from '../src/slack/messages.js';
import { createUi } from '../src/ui.js';
import { parseKey } from '../src/keys.js';
import { configureSlack } from '../../scripts/slack-setup.mjs';

const message = (n, text = 'message ' + n, extra = {}) => ({ type: 'message', ts: '1793350000.' + String(n).padStart(6, '0'), text, user: 'U1', ...extra });
const normalize = (n) => normalizeMessage(message(n));
function fixture(t, api, options = {}) {
  const slack = createSlack({ token: 'fake', channelId: 'C1', autoStart: false,
    api: (method, args) => method === 'users.info' ? Promise.resolve({ user: { name: 'Alice' } }) : api(method, args), ...options });
  t.after(() => slack.stop()); return slack;
}

test('Slack API uses a header credential, allows only read methods, and honors Retry-After without extra requests', async () => {
  let now = 0, calls = 0, limited = true;
  const api = createSlackApi({ token: 'private-token', now: () => now, fetchImpl: async (url, options) => {
    calls++; assert.equal(url.origin, 'https://slack.com'); assert.ok(!String(url).includes('private-token'));
    assert.equal(options.headers.Authorization, 'Bearer private-token'); assert.equal(options.redirect, 'error');
    return limited ? { status: 429, headers: new Headers({ 'retry-after': '30' }) } : { ok: true, status: 200, json: async () => ({ ok: true, messages: [] }) };
  } });
  await assert.rejects(api('chat.postMessage'), /unsupported_method/); assert.equal(calls, 0);
  await assert.rejects(api('conversations.history', { channel: 'C1' }), (e) => e.retryMs === 30_000);
  await assert.rejects(api('conversations.history'), /ratelimited/); assert.equal(calls, 1);
  now = 30_001; limited = false; await api('conversations.history'); assert.equal(calls, 2);
});

test('API failures expose safe codes rather than response content or credentials', async () => {
  const api = createSlackApi({ token: 'secret', fetchImpl: async () => ({ ok: true, json: async () => ({ ok: false, error: '<secret HTML>' }) }) });
  await assert.rejects(api('auth.test'), (e) => e.message === 'invalid_response');
  const failed = createSlackApi({ token: 'secret', fetchImpl: async () => { throw new Error('secret'); } });
  await assert.rejects(failed('auth.test'), (e) => e.message === 'connection_failed');
});

test('Slack normalization includes attachment and block text, files, and exact timestamp ordering; replies stay out of the channel list', () => {
  const m = normalizeMessage(message(1, '*Subject*', { attachments: [{ text: 'Full body', fields: [{ title: 'Version', value: '2.0' }] }], files: [{ title: 'report.txt' }], reply_count: 3 }));
  assert.match(m.text, /Subject[\s\S]*Full body[\s\S]*Version: 2.0[\s\S]*report.txt/); assert.equal(m.replyCount, 3);
  const rich = normalizeMessage(message(2, '', { blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'Important', style: { bold: true } }] }] }] }));
  assert.equal(rich.text, '*Important*');
  assert.equal(normalizeMessage(message(3, 'reply', { thread_ts: message(1).ts })), null);
  assert.equal(normalizeMessage(message(4, 'join', { subtype: 'channel_join' })), null);
  assert.equal(normalizeMessage({ ts: 'bad', type: 'message' }), null);
  assert.equal(compareTs('1793350000.000001', '1793350000.000002'), -1);
  assert.equal(compareTs('1793350000.1', '1793350000.100000'), 0);
});

test('Slack mrkdwn keeps bold, lists, quotes, links and code readable while escaping HTML', () => {
  const html = renderSlackText('*Subject* <https://example.com|ticket>\n\n&gt; Quoted\n\n- Item\n\n`*literal*` <@U1> &lt;script&gt;alert(1)&lt;/script&gt;', { U1: 'Alice' });
  assert.match(html, /<strong>Subject<\/strong>/); assert.match(html, /<blockquote>/); assert.match(html, /<li>Item<\/li>/);
  assert.match(html, /<code>\*literal\*<\/code>/); assert.match(html, /@Alice/); assert.match(html, /ticket/);
  assert.doesNotMatch(html, /<script>|<img|href=/); assert.match(html, /&lt;script&gt;/);
  assert.match(renderSlackText('First line\nSecond line'), /First line<br>\s*Second line/);
});

test('HelpScout Block Kit body takes precedence over the short notification fallback', () => {
  const text = '*Support request*\n\n> Full customer message\n> Second paragraph';
  const m = normalizeMessage(message(1, 'Support request', { blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] }));
  assert.equal(m.text, text); assert.match(renderSlackText(m.text), /Full customer message/);
  assert.equal((m.text.match(/Support request/g) || []).length, 1);
});

test('polling inserts new messages first, updates edits, removes deleted recent messages and retains data across errors', async (t) => {
  let rows = [message(2), message(1)], failure = false, time = 100;
  const slack = fixture(t, async () => { if (failure) throw new SlackError('connection_failed'); return { messages: rows }; }, { now: () => time });
  await slack.poll(); assert.deepEqual(slack.state.messages.map((m) => m.id), [message(2).ts, message(1).ts]);
  rows = [message(3), message(2, 'edited'), message(1)]; await slack.poll();
  assert.equal(slack.state.messages[0].id, message(3).ts); assert.equal(slack.state.messages[1].text, 'edited');
  failure = true; await slack.poll(); assert.equal(slack.state.messages.length, 3); assert.equal(slack.state.error, 'connection_failed');
  failure = false; time += 20_000; rows = [message(3), message(1)]; await slack.poll();
  assert.deepEqual(slack.state.messages.map((m) => m.id), [message(3).ts, message(1).ts]); assert.equal(slack.state.error, '');
});

test('history pagination merges older messages without duplicates or resetting an exhausted cursor on refresh', async (t) => {
  let requests = [];
  const slack = fixture(t, async (_, args) => {
    if (_ === 'conversations.info') return { channel: {} };
    requests.push(args.cursor || (args.latest ? 'refresh' : 'head'));
    if (args.latest) return { messages: [message(2), message(1)] };
    return args.cursor ? { messages: [message(2), message(1)] } : { messages: [message(3), message(2)], response_metadata: { next_cursor: 'older' } };
  });
  await slack.poll(); await slack.loadMore(); assert.equal(slack.state.messages.length, 3); assert.equal(slack.state.hasMore, false);
  await slack.poll(); await slack.loadMore(); assert.equal(slack.state.messages.length, 3); assert.equal(slack.state.hasMore, false);
  assert.deepEqual(requests, ['head', 'older', 'head', 'refresh']);
});

test('a thread includes every page in chronological order; a refresh error keeps the previously loaded replies', async (t) => {
  let failed = false;
  const slack = fixture(t, async (method, args) => {
    assert.equal(method, 'conversations.replies');
    if (failed) throw new SlackError('ratelimited', 60_000);
    return args.cursor ? { messages: [message(3, 'last reply')] } :
      { messages: [message(1, 'root'), message(2, 'reply')], response_metadata: { next_cursor: 'next' } };
  });
  await slack.loadThread(message(1).ts); assert.deepEqual(slack.state.threads[message(1).ts].messages.map((m) => m.text), ['root', 'reply', 'last reply']);
  failed = true; await slack.loadThread(message(1).ts, true);
  assert.equal(slack.state.threads[message(1).ts].messages.length, 3); assert.equal(slack.state.threads[message(1).ts].error, 'ratelimited');
});

test('concurrent thread reads coalesce, and shutdown prevents a late response from publishing', async (t) => {
  let resolve, calls = 0;
  const slack = fixture(t, () => { calls++; return new Promise((r) => { resolve = r; }); });
  const a = slack.loadThread(message(1).ts), b = slack.loadThread(message(1).ts);
  assert.equal(calls, 1); slack.stop(); resolve({ messages: [message(1)] }); await Promise.all([a, b]);
  assert.equal(slack.state.threads[message(1).ts].messages.length, 0);
});

test('Q opens Slack; grid selection follows an inserted message and thread paging never answers or compacts', () => {
  assert.equal(parseKey('16 1').action, 'screen:slack');
  const ui = createUi(), ctx = { sessions: [{ id: 'session' }], slackMessages: Array.from({ length: 9 }, (_, i) => normalize(9 - i)), orientation: 'portrait' };
  ui.act('screen:slack', ctx); ui.act('down', ctx); assert.equal(ui.slackSelectedId, message(8).ts);
  ctx.slackMessages.unshift(normalize(10)); assert.equal(ui.slackSelectedIndex(ctx.slackMessages), 2);
  ui.act('open', ctx); assert.equal(ui.screen, 'slack-detail'); assert.equal(ui.slackSelectedId, message(8).ts);
  ui.setSlackPages({ pages: 3, page: 0 }); ui.act('down', ctx); assert.equal(ui.slackPage, 1);
  ui.surfaceQueue(); assert.equal(ui.screen, 'queue'); ui.queueEmptied(); assert.equal(ui.screen, 'slack-detail'); assert.equal(ui.slackPage, 1);
  for (const action of ['allow', 'deny', 'compact', 'open']) {
    const r = ui.act(action, ctx); assert.equal(r.answer, undefined); assert.equal(r.compact, undefined); assert.equal(r.focus, undefined);
  }
  ui.act('right', ctx); assert.equal(ui.slackPage, 0); ui.act('back', ctx); assert.equal(ui.screen, 'slack');
  const land = createUi(), landscape = { ...ctx, orientation: 'landscape' };
  land.act('screen:slack', landscape); land.act('right', landscape); land.act('down', landscape);
  assert.equal(land.slackSelectedIndex(landscape.slackMessages), 3);
  ui.act('screen:next', ctx); assert.equal(ui.screen, 'queue');
});

test('Enter jumps to the last thread page without changing its selection and stays local to thread details', () => {
  for (const orientation of ['portrait', 'landscape']) {
    const ui = createUi(), ctx = { sessions: [{ id: 'session' }], slackMessages: [normalize(2), normalize(1)], orientation };
    const enter = () => ui.act(parseKey('28 1').action, ctx);
    assert.deepEqual(enter(), { changed: false });
    ui.act('open', ctx); assert.deepEqual(enter(), { changed: false });
    ui.act('screen:slack', ctx); assert.deepEqual(enter(), { changed: false });
    ui.act('open', ctx); ui.setSlackPages({ pages: 20, page: 3 });
    assert.deepEqual(enter(), { changed: true, full: false });
    assert.equal(ui.slackPage, 19); assert.equal(ui.slackSelectedId, message(2).ts);
    assert.deepEqual(enter(), { changed: false }, 'already at the end');
    ui.act('up', ctx); assert.equal(ui.slackPage, 18, 'normal scrolling still works');
    ui.setSlackPages({ pages: 22, page: 18 }); enter(); assert.equal(ui.slackPage, 21, 'uses the current thread length');
    ui.act('right', ctx); assert.equal(ui.slackPage, 0); assert.deepEqual(enter(), { changed: false }, 'single page');
    ui.surfaceQueue(); assert.deepEqual(enter(), { changed: false }, 'never answers or focuses from Queue');
    ui.act('screen:usage', ctx); assert.deepEqual(enter(), { changed: false });
  }
});

test('Slack setup validates history and thread access before saving and preserves other dashboard settings', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-slack-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configFile = path.join(dir, 'config.json'), tokenFile = path.join(dir, 'token');
  fs.writeFileSync(configFile, JSON.stringify({ lanHost: '192.168.1.2', deviceToken: 'keep' }));
  const settings = { token: 'xoxp-test-token', channelId: 'C1', configFile, tokenFile };
  await assert.rejects(configureSlack({ ...settings, api: async () => { throw new SlackError('missing_scope'); } }), /missing_scope/);
  assert.equal(fs.existsSync(tokenFile), false); assert.equal(JSON.parse(fs.readFileSync(configFile)).deviceToken, 'keep');
  const calls = [];
  await configureSlack({ ...settings, api: async (method) => { calls.push(method); return { channel: { name: 'twk-support' }, messages: [message(1)] }; } });
  assert.deepEqual(calls, ['auth.test', 'conversations.info', 'conversations.history', 'conversations.replies']);
  const saved = JSON.parse(fs.readFileSync(configFile)); assert.equal(saved.deviceToken, 'keep'); assert.equal(saved.slackChannelName, 'twk-support');
  assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600); assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(saved).includes(settings.token));
});
