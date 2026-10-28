// What the Kindle is looking at, and how key actions (keys.js) move it.
// Pure state: dashd renders from it and carries out the one side effect a key
// can ask for here (raising a session's window).

import { PER_PAGE } from './screens/sessions.js';

// The screens page-turn cycles through. The session detail belongs to
// Sessions; the Queue joins in M3; the test card stays reachable from MENU as
// a diagnostic.
export const SCREENS = ['sessions', 'usage'];

export function createUi() {
  const ui = {
    screen: 'sessions',
    selectedId: null,   // follows the session, not its position, across reorders
    msgPage: 0,         // detail: page of the last message on screen
    msgPages: 1,        // detail: how many there are, as the last render measured
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

  // ctx: { sessions, orientation }. Returns { changed, full, focus? }.
  function act(action, ctx) {
    switch (action) {
      case 'screen:sessions': return show('sessions');
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
    if (ui.screen === 'detail') return detailKey(action, ctx.sessions);
    if (ui.screen === 'sessions') {
      if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
        return move(ctx.sessions, ctx.orientation, action);
      }
      if (action === 'open') return openDetail(ctx.sessions);
    }
    return { changed: false };
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
    get screen() { return ui.screen; },
    get selectedId() { return ui.selectedId; },
    get msgPage() { return ui.msgPage; },
  };
}
