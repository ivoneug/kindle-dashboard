// What the Kindle is looking at, and how key actions (keys.js) move it.
// Pure state: dashd renders from it and carries out the side effects a key can
// ask for here — raising a session's window, answering a permission (after
// checking the frame the key was pressed on, which only dashd knows).

import { PER_PAGE } from './screens/sessions.js';

// The screens page-turn cycles through. The session detail belongs to
// Sessions; the test card stays reachable from MENU as a diagnostic.
export const SCREENS = ['sessions', 'queue', 'usage'];

// A destructive command needs a second Y, and the second has to come while the
// "press Y again" frame is up.
export const ARM_MS = 10_000;

const ANSWERS = { allow: 'allow', deny: 'deny', back: 'ask' };

export function createUi() {
  const ui = {
    screen: 'sessions',
    selectedId: null,   // follows the session, not its position, across reorders
    msgPage: 0,         // detail: page of the last message on screen
    msgPages: 1,        // detail: how many there are, as the last render measured
    heroId: null,       // queue: the ask the keys act on (default: the oldest)
    armed: null,        // queue: {id, until} after a first Y on a destructive ask
    surfacedFrom: null, // queue: the screen it took over from, to go back to
    note: '',           // short status line in the footer
    noteUntil: 0,
  };

  function selectedIndex(sessions) {
    const i = sessions.findIndex((s) => s.id === ui.selectedId);
    return i >= 0 ? i : 0;
  }

  function show(screen) {
    if (ui.screen === screen) return { changed: false };
    ui.screen = screen;
    // Going anywhere by hand ends the queue's claim to give the screen back.
    ui.surfacedFrom = null;
    ui.armed = null;
    // A different screen means most of the panel changes: flash it clean.
    return { changed: true, full: true };
  }

  function move(sessions, orientation, action) {
    if (!sessions.length) return { changed: false };
    const grid = orientation === 'landscape';
    const step = {
      up: grid ? -2 : -1,
      down: grid ? 2 : 1,
      left: grid ? -1 : -PER_PAGE,
      right: grid ? 1 : PER_PAGE,
    }[action];
    const from = selectedIndex(sessions);
    const to = Math.max(0, Math.min(sessions.length - 1, from + step));
    ui.selectedId = sessions[to].id;
    if (to === from) return { changed: false };
    // Turning a page replaces every tile.
    return { changed: true, full: Math.floor(to / PER_PAGE) !== Math.floor(from / PER_PAGE) };
  }

  function openDetail(sessions) {
    if (!sessions.length) return { changed: false };
    ui.selectedId = sessions[selectedIndex(sessions)].id;
    ui.msgPage = 0;
    ui.msgPages = 1;
    return show('detail');
  }

  // Detail keys: ←→ walk the sessions without going back to the list, ↑↓ page
  // the message, centre raises the window, Back returns to the list.
  function detailKey(action, sessions) {
    switch (action) {
      case 'left':
      case 'right': {
        if (!sessions.length) return { changed: false };
        const from = selectedIndex(sessions);
        const to = Math.max(0, Math.min(sessions.length - 1, from + (action === 'right' ? 1 : -1)));
        if (to === from) return { changed: false };
        ui.selectedId = sessions[to].id;
        ui.msgPage = 0;
        ui.msgPages = 1;
        return { changed: true, full: true };
      }
      case 'up':
      case 'down': {
        const to = Math.max(0, Math.min(ui.msgPages - 1, ui.msgPage + (action === 'down' ? 1 : -1)));
        if (to === ui.msgPage) return { changed: false };
        ui.msgPage = to;
        return { changed: true, full: false };
      }
      case 'open':
        return sessions.length ? { changed: false, focus: sessions[selectedIndex(sessions)].id } : { changed: false };
      case 'back':
        return show('sessions');
    }
    return { changed: false };
  }

  function heroOf(asks) {
    return asks.find((a) => a.id === ui.heroId) || asks[0] || null;
  }

  function isArmed(id) {
    return !!ui.armed && ui.armed.id === id && Date.now() < ui.armed.until;
  }

  // Queue keys: ↑↓ pick the ask, Y / N / Back answer a permission (dashd
  // checks the frame first), centre raises the ask's session.
  function queueKey(action, asks) {
    const hero = heroOf(asks);
    switch (action) {
      case 'up':
      case 'down': {
        if (asks.length < 2) return { changed: false };
        const from = asks.indexOf(hero);
        const to = Math.max(0, Math.min(asks.length - 1, from + (action === 'down' ? 1 : -1)));
        if (to === from) return { changed: false };
        ui.heroId = asks[to].id;
        ui.armed = null;
        return { changed: true, full: true };
      }
      case 'open':
        return hero && hero.sessionId ? { changed: false, focus: hero.sessionId } : { changed: false };
      case 'allow':
      case 'deny':
      case 'back':
        if (!hero) return action === 'back' ? leaveQueue() : { changed: false };
        if (hero.kind !== 'permission') {
          return action === 'back' ? leaveQueue() : { changed: false, note: 'ANSWER IT IN THE SESSION WINDOW' };
        }
        return { changed: false, answer: { id: hero.id, decision: ANSWERS[action], destructive: !!hero.destructive } };
    }
    return { changed: false };
  }

  function leaveQueue() {
    const back = ui.surfacedFrom || 'sessions';
    return show(back);
  }

  // ctx: { sessions, asks, orientation }. Returns { changed, full, focus?,
  // answer?, note? }.
  function act(action, ctx) {
    switch (action) {
      case 'screen:sessions': return show('sessions');
      case 'screen:queue': return show('queue');
      case 'screen:usage': return show('usage');
      case 'screen:next':
      case 'screen:prev': {
        const i = SCREENS.indexOf(ui.screen === 'detail' ? 'sessions' : ui.screen);
        const d = action === 'screen:next' ? 1 : -1;
        return show(SCREENS[(Math.max(0, i) + d + SCREENS.length) % SCREENS.length]);
      }
      case 'menu': return show(ui.screen === 'test' ? 'sessions' : 'test');
      case 'refresh': return { changed: true, full: true };
    }
    if (ui.screen === 'queue') return queueKey(action, ctx.asks || []);
    if (ui.screen === 'detail') return detailKey(action, ctx.sessions);
    if (ui.screen === 'sessions') {
      if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
        return move(ctx.sessions, ctx.orientation, action);
      }
      if (action === 'open') return openDetail(ctx.sessions);
    }
    return { changed: false };
  }

  // A new ask arrived: the queue takes the screen, remembering what it covered.
  function surfaceQueue() {
    if (ui.screen === 'queue') return false;
    ui.surfacedFrom = ui.screen === 'test' ? 'sessions' : ui.screen;
    ui.screen = 'queue';
    ui.armed = null;
    return true;
  }

  // Nothing left to answer: hand the screen back if the queue took it.
  function queueEmptied() {
    if (ui.screen !== 'queue' || !ui.surfacedFrom) return false;
    ui.screen = ui.surfacedFrom;
    ui.surfacedFrom = null;
    return true;
  }

  function arm(id) {
    ui.armed = { id, until: Date.now() + ARM_MS };
  }

  function disarm() {
    ui.armed = null;
  }

  // What the detail render measured: the page actually shown (clamped there if
  // the message got shorter) and how many there are.
  function setMessagePages({ pages, page }) {
    ui.msgPages = Math.max(1, pages);
    ui.msgPage = Math.max(0, Math.min(ui.msgPages - 1, page));
  }

  // The session on the detail screen is gone (ended, retired): back to the list.
  function leaveDetail() {
    if (ui.screen === 'detail') ui.screen = 'sessions';
  }

  function setNote(text, ms = 6000) {
    ui.note = text;
    ui.noteUntil = Date.now() + ms;
  }

  function note() {
    return Date.now() < ui.noteUntil ? ui.note : '';
  }

  return {
    act,
    setNote,
    note,
    selectedIndex,
    setMessagePages,
    leaveDetail,
    heroOf,
    isArmed,
    surfaceQueue,
    queueEmptied,
    arm,
    disarm,
    get screen() { return ui.screen; },
    get selectedId() { return ui.selectedId; },
    get msgPage() { return ui.msgPage; },
  };
}
