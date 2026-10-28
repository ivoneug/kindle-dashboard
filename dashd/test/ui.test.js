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

test('detail: left/right walk the sessions, and the list selection follows', () => {
  const ui = createUi();
  ui.act('open', portrait);
  assert.deepEqual(ui.act('left', portrait), { changed: false }, 'already first');
  ui.act('right', portrait);
  ui.act('right', portrait);
  assert.equal(ui.selectedId, 's2');
  ui.act('back', portrait);
  assert.equal(ui.selectedIndex(sessions), 2);
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
  assert.equal(ui.screen, 'usage');
});

test('MENU toggles the test card', () => {
  const ui = createUi();
  ui.act('menu', portrait);
  assert.equal(ui.screen, 'test');
  ui.act('menu', portrait);
  assert.equal(ui.screen, 'sessions');
});

test('answers are not handled here yet (M3)', () => {
  const ui = createUi();
  for (const a of ['allow', 'deny', 'back', 'screen:queue']) assert.deepEqual(ui.act(a, portrait), { changed: false });
  assert.equal(ui.screen, 'sessions');
});

test('a note shows until it expires', () => {
  const ui = createUi();
  ui.setNote('RAISED x', 50);
  assert.equal(ui.note(), 'RAISED x');
  return new Promise((r) => setTimeout(() => { assert.equal(ui.note(), ''); r(); }, 70));
});
