import test from 'node:test';
import assert from 'node:assert/strict';
import { createUi } from '../src/ui.js';

const sessions = Array.from({ length: 9 }, (_, i) => ({ id: 's' + i }));
const portrait = { sessions, orientation: 'portrait' };
const landscape = { sessions, orientation: 'landscape' };

test('screen keys switch screens with a full refresh, and do nothing when already there', () => {
  const ui = createUi();
  assert.equal(ui.screen, 'sessions');
  assert.deepEqual(ui.act('screen:usage', portrait), { changed: true, full: true });
  assert.equal(ui.screen, 'usage');
  assert.deepEqual(ui.act('screen:usage', portrait), { changed: false });
});

test('page turns cycle the screens both ways', () => {
  const ui = createUi();
  ui.act('screen:next', portrait);
  assert.equal(ui.screen, 'slack');
  ui.act('screen:next', portrait);
  assert.equal(ui.screen, 'queue');
  ui.act('screen:next', portrait);
  assert.equal(ui.screen, 'usage');
  ui.act('screen:next', portrait);
  assert.equal(ui.screen, 'sessions');
  ui.act('screen:prev', portrait);
  assert.equal(ui.screen, 'usage');
});

test('portrait: up/down step one tile, left/right a page; turning a page is a full refresh', () => {
  const ui = createUi();
  assert.deepEqual(ui.act('down', portrait), { changed: true, full: false });
  assert.equal(ui.selectedIndex(sessions), 1);
  assert.deepEqual(ui.act('right', portrait), { changed: true, full: true });
  assert.equal(ui.selectedIndex(sessions), 5);
  ui.act('right', portrait);
  ui.act('right', portrait);
  assert.equal(ui.selectedIndex(sessions), 8, 'clamped at the last session');
  assert.deepEqual(ui.act('down', portrait), { changed: false });
});

test('landscape: the 2×2 grid moves by row and column', () => {
  const ui = createUi();
  ui.act('right', landscape);
  assert.equal(ui.selectedIndex(sessions), 1);
  ui.act('down', landscape);
  assert.equal(ui.selectedIndex(sessions), 3);
  ui.act('left', landscape);
  assert.equal(ui.selectedIndex(sessions), 2);
});

test('the selection follows the session when the list reorders', () => {
  const ui = createUi();
  ui.act('down', portrait);
  ui.act('down', portrait);
  const reordered = [sessions[2], ...sessions.filter((s) => s.id !== 's2')];
  assert.equal(ui.selectedIndex(reordered), 0);
});

test('centre on Sessions opens the selected session; on Usage it does nothing', () => {
  const ui = createUi();
  ui.act('down', portrait);
  assert.deepEqual(ui.act('open', portrait), { changed: true, full: true });
  assert.equal(ui.screen, 'detail');
  assert.equal(ui.selectedId, 's1');
  ui.act('screen:usage', portrait);
  assert.deepEqual(ui.act('open', portrait), { changed: false });
  assert.deepEqual(ui.act('down', portrait), { changed: false });
});

test('detail: centre raises the window, Back returns to the list', () => {
  const ui = createUi();
  ui.act('open', portrait);
  assert.deepEqual(ui.act('open', portrait), { changed: false, focus: 's0' });
  assert.deepEqual(ui.act('back', portrait), { changed: true, full: true });
  assert.equal(ui.screen, 'sessions');
});

test('detail: left/right walk the sessions, and Back opens the list from its beginning', () => {
  const ui = createUi();
  ui.act('open', portrait);
  assert.deepEqual(ui.act('left', portrait), { changed: false }, 'already first');
  ui.act('right', portrait);
  ui.act('right', portrait);
  assert.equal(ui.selectedId, 's2');
  ui.act('back', portrait);
  assert.equal(ui.selectedIndex(sessions), 0);
});

test('S and Q always start at the newest tile, including repeated presses on the same screen', () => {
  for (const orientation of ['portrait', 'landscape']) for (const screen of ['sessions', 'slack']) {
    const ui = createUi(), ctx = { sessions, slackMessages: sessions, orientation };
    const selected = () => screen === 'sessions' ? ui.selectedIndex(sessions) : ui.slackSelectedIndex(sessions);
    ui.act('screen:' + screen, ctx); ui.act('right', ctx); ui.act('down', ctx);
    assert.ok(selected() > 0);
    assert.deepEqual(ui.act('screen:' + screen, ctx), { changed: true, full: true });
    assert.equal(selected(), 0);
    assert.deepEqual(ui.act('screen:' + screen, ctx), { changed: false });
    ui.act('down', ctx); ui.act('screen:usage', ctx); ui.act('screen:' + screen, ctx);
    assert.equal(selected(), 0);
  }
});

test('page-turn navigation enters both lists at the beginning', () => {
  const ui = createUi(), ctx = { ...portrait, slackMessages: sessions };
  ui.act('right', ctx); ui.act('screen:next', ctx); assert.equal(ui.screen, 'slack');
  ui.act('right', ctx); ui.act('screen:next', ctx); ui.act('screen:next', ctx); ui.act('screen:next', ctx);
  assert.equal(ui.screen, 'sessions'); assert.equal(ui.selectedIndex(sessions), 0);
  ui.act('screen:next', ctx); assert.equal(ui.screen, 'slack'); assert.equal(ui.slackSelectedIndex(sessions), 0);
});

test('Back from a Slack thread resets both the list position and message page', () => {
  const ui = createUi(), ctx = { ...portrait, slackMessages: sessions };
  ui.act('screen:slack', ctx); ui.act('right', ctx); ui.act('open', ctx);
  ui.setSlackPages({ pages: 5, page: 3 }); ui.act('back', ctx);
  assert.equal(ui.screen, 'slack'); assert.equal(ui.slackSelectedIndex(sessions), 0); assert.equal(ui.slackPage, 0);
});

test('return from an automatic Queue starts a list at the beginning while preserving an interrupted thread', () => {
  for (const screen of ['sessions', 'slack']) {
    const ui = createUi(), ctx = { ...portrait, slackMessages: sessions };
    ui.act('screen:' + screen, ctx); ui.act('right', ctx); ui.surfaceQueue(); ui.queueEmptied();
    assert.equal(ui.screen, screen);
    assert.equal(screen === 'sessions' ? ui.selectedIndex(sessions) : ui.slackSelectedIndex(sessions), 0);
  }
  const ui = createUi(), ctx = { ...portrait, slackMessages: sessions };
  ui.act('screen:slack', ctx); ui.act('right', ctx); ui.act('open', ctx); ui.setSlackPages({ pages: 5, page: 3 });
  const id = ui.slackSelectedId; ui.surfaceQueue(); ui.queueEmptied();
  assert.equal(ui.screen, 'slack-detail'); assert.equal(ui.slackSelectedId, id); assert.equal(ui.slackPage, 3);
});

test('waking Ambient into a list resets its selection for both user input and new work', () => {
  for (const screen of ['sessions', 'slack']) for (const automatic of [false, true]) {
    let ts = 0; const ui = createUi({ now: () => ts }), ctx = { ...portrait, slackMessages: sessions };
    ui.act('screen:' + screen, ctx); ui.act('right', ctx); ts = 120_000; ui.syncAmbient({});
    assert.equal(ui.screen, 'ambient');
    if (automatic) ui.syncAmbient({ sessions: [{ state: 'busy' }] }); else ui.act('wake', ctx);
    assert.equal(ui.screen, screen);
    assert.equal(screen === 'sessions' ? ui.selectedIndex(sessions) : ui.slackSelectedIndex(sessions), 0);
  }
});

test('detail: up/down page the message within what the render measured', () => {
  const ui = createUi();
  ui.act('open', portrait);
  assert.deepEqual(ui.act('down', portrait), { changed: false }, 'one page until measured');
  ui.setMessagePages({ pages: 3, page: 0 });
  assert.deepEqual(ui.act('down', portrait), { changed: true, full: false });
  ui.act('down', portrait);
  assert.equal(ui.msgPage, 2);
  assert.deepEqual(ui.act('down', portrait), { changed: false });
  ui.act('right', portrait);
  assert.equal(ui.msgPage, 0, 'another session starts at its first page');
});

test('detail: a message that shrank clamps the page', () => {
  const ui = createUi();
  ui.act('open', portrait);
  ui.setMessagePages({ pages: 4, page: 3 });
  ui.setMessagePages({ pages: 2, page: 1 });
  assert.equal(ui.msgPage, 1);
});

test('page turns from the detail move on from Sessions', () => {
  const ui = createUi();
  ui.act('open', portrait);
  ui.act('screen:next', portrait);
  assert.equal(ui.screen, 'slack');
});

test('MENU toggles the test card', () => {
  const ui = createUi();
  ui.act('menu', portrait);
  assert.equal(ui.screen, 'test');
  ui.act('menu', portrait);
  assert.equal(ui.screen, 'sessions');
});

test('answer keys do nothing outside the queue', () => {
  const ui = createUi();
  for (const a of ['allow', 'deny']) assert.deepEqual(ui.act(a, portrait), { changed: false });
  assert.equal(ui.screen, 'sessions');
});

const perm = (id, extra = {}) => ({ kind: 'permission', id, sessionId: 'sess-' + id, tool: 'Bash', summary: 'ls', ...extra });
const question = (id) => ({ kind: 'question', id, sessionId: 'sess-' + id, question: 'Which?' });

test('queue: Y / N / Back answer the hero permission — allow, deny, to the terminal', () => {
  const ui = createUi();
  const asks = [perm('a'), perm('b', { destructive: true })];
  ui.act('screen:queue', portrait);
  const ctx = { ...portrait, asks };
  assert.deepEqual(ui.act('allow', ctx).answer, { id: 'a', decision: 'allow', destructive: false });
  assert.deepEqual(ui.act('deny', ctx).answer, { id: 'a', decision: 'deny', destructive: false });
  assert.deepEqual(ui.act('back', ctx).answer, { id: 'a', decision: 'ask', destructive: false });
  ui.act('down', ctx);
  assert.deepEqual(ui.act('allow', ctx).answer, { id: 'b', decision: 'allow', destructive: true });
});

test('queue: a question is not answered here; Back leaves, centre raises its session', () => {
  const ui = createUi();
  const ctx = { ...portrait, asks: [question('q')] };
  ui.act('screen:queue', portrait);
  assert.equal(ui.act('allow', ctx).answer, undefined);
  assert.ok(ui.act('allow', ctx).note);
  assert.deepEqual(ui.act('open', ctx), { changed: false, focus: 'sess-q' });
  ui.act('back', ctx);
  assert.equal(ui.screen, 'sessions');
});

test('queue: a new ask takes the screen and the last answer gives it back', () => {
  const ui = createUi();
  ui.act('screen:usage', portrait);
  assert.equal(ui.surfaceQueue(), true);
  assert.equal(ui.screen, 'queue');
  assert.equal(ui.surfaceQueue(), false, 'already there');
  assert.equal(ui.queueEmptied(), true);
  assert.equal(ui.screen, 'usage');
});

test('queue: opened by hand, it stays when it empties', () => {
  const ui = createUi();
  ui.act('screen:queue', portrait);
  assert.equal(ui.queueEmptied(), false);
  assert.equal(ui.screen, 'queue');
});

test('queue: leaving by hand cancels the way back', () => {
  const ui = createUi();
  ui.surfaceQueue();
  ui.act('screen:usage', portrait);
  ui.act('screen:queue', portrait);
  assert.equal(ui.queueEmptied(), false);
});

test('queue: the hero follows its ask, and falls back to the oldest when it is gone', () => {
  const ui = createUi();
  ui.act('screen:queue', portrait);
  ui.act('down', { ...portrait, asks: [perm('a'), perm('b')] });
  assert.equal(ui.heroOf([perm('a'), perm('b')]).id, 'b');
  assert.equal(ui.heroOf([perm('c'), perm('a')]).id, 'c');
});

test('queue: arming lasts ARM_MS and only for its ask', () => {
  const ui = createUi();
  ui.arm('a');
  assert.ok(ui.isArmed('a'));
  assert.ok(!ui.isArmed('b'));
  ui.disarm();
  assert.ok(!ui.isArmed('a'));
});

test('a note shows until it expires', () => {
  const ui = createUi();
  ui.setNote('RAISED x', 50);
  assert.equal(ui.note(), 'RAISED x');
  return new Promise((r) => setTimeout(() => { assert.equal(ui.note(), ''); r(); }, 70));
});

test('Ambient waits for both quiet sessions and two minutes without key presses', () => {
  let ts = 0;
  const ui = createUi({ now: () => ts });
  const quiet = { sessions: [{ state: 'idle' }] };
  ts = 119_999;
  assert.equal(ui.syncAmbient(quiet), false);
  ui.act('screen:usage', portrait);
  ts += 120_000;
  assert.equal(ui.syncAmbient(quiet), true);
  assert.equal(ui.screen, 'ambient');
  assert.deepEqual(ui.act('allow', portrait), { changed: true, full: true });
  assert.equal(ui.screen, 'usage', 'wake restores the screen, without answering anything');
  assert.equal(ui.syncAmbient(quiet), false);
});

test('working sessions, attention, requests and backend errors prevent Ambient', () => {
  for (const context of [
    { sessions: [{ state: 'busy' }] }, { sessions: [{ state: 'attention' }] },
    { asks: [perm('a')] }, { healthy: false },
  ]) {
    let ts = 0;
    const ui = createUi({ now: () => ts });
    ts = 200_000;
    assert.equal(ui.syncAmbient(context), false);
    ts += 119_999;
    assert.equal(ui.syncAmbient({}), false, 'quiet delay starts after work stops');
    ts += 1;
    assert.equal(ui.syncAmbient({}), true);
    assert.equal(ui.syncAmbient(context), true, 'new activity wakes immediately');
    assert.equal(ui.screen, 'sessions');
  }
});

test('a permission wakes Ambient to Queue and resolution restores the previous screen', () => {
  let ts = 0;
  const ui = createUi({ now: () => ts });
  ui.act('screen:usage', portrait);
  ts = 120_000;
  ui.syncAmbient({});
  assert.equal(ui.screen, 'ambient');
  ui.surfaceQueue();
  assert.equal(ui.screen, 'queue');
  ui.queueEmptied();
  assert.equal(ui.screen, 'usage');
  assert.equal(ui.syncAmbient({}), false);
});

test('Ambient can be disabled, does not hide diagnostics, and direct screen keys still work', () => {
  let ts = 0;
  const disabled = createUi({ ambientAfterMs: 0, now: () => ts });
  const ui = createUi({ now: () => ts });
  ui.act('menu', portrait);
  ts = 200_000;
  assert.equal(disabled.syncAmbient({}), false);
  assert.equal(ui.syncAmbient({}), false);
  ui.act('menu', portrait);
  ts += 120_000;
  ui.syncAmbient({});
  assert.equal(ui.screen, 'ambient');
  ui.act('screen:queue', portrait);
  assert.equal(ui.screen, 'queue');
});
