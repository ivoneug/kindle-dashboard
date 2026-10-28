// dashd: renders e-ink frames on the Mac and serves them to the Kindle K3, and
// runs the Claude Code side (sessions, permission bridge, usage) in-process.
// Screens: Sessions and Usage (M2), plus the M1 test card behind MENU. A frame
// is rendered on key presses, Claude events and once a minute for the clock,
// and only sent when it differs from the one on screen.

import {
  PORT, USB_HOST, USB_BIND_RETRY_MS, PANEL, ORIENTATION, LANDSCAPE_ROTATE,
  FULL_EVERY, KEEP_FRAMES, LONG_POLL_MS, RENDER_DEBOUNCE_MS, MIN_FRAME_INTERVAL_MS, LINK_ALIVE_MS,
  CHROME_CHANNEL, CHROME_PATH,
} from './config.js';
import { createRenderer } from './renderer.js';
import { createFrameStore } from './frames.js';
import { createHandler, listen } from './http-server.js';
import { parseKey } from './keys.js';
import { renderTestCard } from './screens/test-card.js';
import { renderSessions } from './screens/sessions.js';
import { renderUsage } from './screens/usage.js';
import { renderDetail } from './screens/detail.js';
import { createUi } from './ui.js';
import { createClaude } from './claude/index.js';
import { MOCK_SESSIONS } from './claude/config.js';
import { log } from './log.js';

const state = {
  orientation: ORIENTATION === 'landscape' ? 'landscape' : 'portrait',
  keys: [],          // newest first
  lastPollTs: 0,     // last /version from the Kindle (not from the preview)
};

const ui = createUi();
const frames = createFrameStore({ fullEvery: FULL_EVERY, keep: KEEP_FRAMES });
const renderer = createRenderer({ channel: CHROME_CHANNEL, executablePath: CHROME_PATH });

function linked() {
  return Date.now() - state.lastPollTs < LINK_ALIVE_MS;
}

// A permission request waits for the Kindle only while one is attached, and
// only once the Kindle can show and answer it: until the Queue screen and
// Y/N/Back exist (M3), holding would just block every session for ten
// minutes. Mock mode always holds — its asks block nobody, and the screens
// need them to show ATTENTION.
const KINDLE_ANSWERS_PERMISSIONS = false;
const claude = createClaude({
  onChange: () => scheduleRender(),
  shouldHold: () => MOCK_SESSIONS || (KINDLE_ANSWERS_PERMISSIONS && linked()),
});

function layout() {
  return state.orientation === 'landscape'
    ? { width: PANEL.height, height: PANEL.width, rotateDeg: LANDSCAPE_ROTATE }
    : { width: PANEL.width, height: PANEL.height, rotateDeg: 0 };
}

// Debounced, throttled, single-flight: a burst of changes becomes one frame,
// event-driven frames keep MIN_FRAME_INTERVAL_MS apart, an urgent one (a key
// press) goes out at once, and a change that lands mid-render queues exactly
// one more.
let timer = null;
let timerAt = 0;
let timerUrgent = false;
let rendering = false;
let again = null;        // the options of a render asked for mid-render
let wantFull = false;
let lastLinked = false;
let lastFrameTs = 0;

function scheduleRender({ full = false, urgent = false } = {}) {
  wantFull = wantFull || full;
  const now = Date.now();
  const at = urgent ? now + 50 : Math.max(now + RENDER_DEBOUNCE_MS, lastFrameTs + MIN_FRAME_INTERVAL_MS);
  if (timer && timerAt <= at) return;
  clearTimeout(timer);
  timerAt = at;
  timerUrgent = urgent;
  timer = setTimeout(renderNow, at - now);
}

async function renderNow() {
  timer = null;
  if (rendering) { again = { urgent: timerUrgent }; return; }
  rendering = true;
  const full = wantFull;
  wantFull = false;
  try {
    const t0 = Date.now();
    const box = layout();
    lastLinked = linked();
    const html = screenHtml(box);
    const frame = await renderer.render(html, box);
    if (ui.screen === 'detail' && frame.meta) ui.setMessagePages(frame.meta);
    // Claude events fire far more often than anything on screen changes; an
    // identical frame would still cost the Kindle a redraw.
    const cur = frames.current();
    if (!full && cur && cur.png.equals(frame.png)) return;
    const v = frames.publish(frame.png, { full });
    lastFrameTs = Date.now();
    log('FR', `v${v} ${frame.width}×${frame.height} ${(frame.png.length / 1024).toFixed(0)}KB` +
      `${frames.get(v).full ? ' full' : ''} in ${Date.now() - t0}ms`);
  } catch (err) {
    log('!!', `render failed: ${err.message}`);
  } finally {
    rendering = false;
    if (again) { const opts = again; again = null; scheduleRender(opts); }
  }
}

function screenHtml(box) {
  const sessions = claude.state.sessions;
  const view = {
    orientation: state.orientation,
    linked: lastLinked,
    waiting: claude.asks().length,
    note: ui.note(),
  };
  switch (ui.screen) {
    case 'detail': {
      const i = sessions.findIndex((s) => s.id === ui.selectedId);
      const d = i >= 0 ? claude.detail(sessions[i].id) : null;
      if (!d) {
        // The session went away under the detail screen.
        ui.leaveDetail();
        return screenHtml(box);
      }
      return renderDetail({ ...view, session: d, index: i, total: sessions.length, msgPage: ui.msgPage }, box);
    }
    case 'usage':
      return renderUsage({ ...view, usage: claude.state.usage }, box);
    case 'test':
      return renderTestCard({ ...state, ...view, claude: { sessions: sessions.length, asks: view.waiting } }, box);
    default:
      return renderSessions({
        ...view,
        sessions,
        details: claude.state.details,
        selected: ui.selectedIndex(sessions),
      }, box);
  }
}

// A footer note lasts a few seconds; the frame after it expires drops it.
function showNote(text) {
  ui.setNote(text);
  scheduleRender({ urgent: true });
  setTimeout(() => scheduleRender(), 6_100);
}

// The screen already says which session; the note says what happened.
async function raiseTerminal(id) {
  try {
    const r = await claude.focusSession(id);
    if (r && r.focused) showNote('RAISED ' + (r.app || '') + (r.exact ? '' : ' (APP ONLY)'));
    else showNote('CAN\'T RAISE: ' + ((r && r.reason) || 'unknown'));
  } catch (err) {
    showNote('CAN\'T RAISE: ' + err.message);
  }
}

const handler = createHandler({
  frames,
  longPollMs: LONG_POLL_MS,
  onPoll(local) {
    if (local) return;
    state.lastPollTs = Date.now();
    // The link lamp lights on the first poll after a gap.
    if (!lastLinked) scheduleRender();
  },
  onKey({ code, v, stale, local }) {
    const { press, name, action } = parseKey(code);
    if (!press) return;
    log('KY', `${code}${name ? ' ' + name : ''} v${v}${stale ? ' stale' : ''}${action ? ' → ' + action : ''}${local ? ' (preview)' : ''}`);
    state.keys = [{ code, name, v, stale, action, ts: Date.now() }, ...state.keys].slice(0, 6);
    if (!action) {
      // The test card lists every press; other screens have nothing to show.
      if (ui.screen === 'test') scheduleRender({ urgent: true });
      return;
    }
    const r = ui.act(action, { sessions: claude.state.sessions, orientation: state.orientation });
    if (r.focus) raiseTerminal(r.focus);
    if (r.changed || ui.screen === 'test') scheduleRender({ full: !!r.full, urgent: true });
  },
  onHook: (event, payload, res) => claude.onHook(event, payload, res),
  status: () => ({ ...claude.status(), kindleLinked: linked(), frame: frames.version }),
  devState: () => ({
    version: frames.version,
    orientation: state.orientation,
    screen: ui.screen,
    linked: linked(),
    sessions: claude.state.sessions.length,
    waiting: claude.asks().length,
    usage: claude.state.usage,
    keys: state.keys,
  }),
  devSet({ orientation }) {
    if ((orientation === 'portrait' || orientation === 'landscape') && orientation !== state.orientation) {
      state.orientation = orientation;
      log('--', `orientation → ${orientation}`);
      scheduleRender({ full: true });
    }
  },
  devRefresh: () => scheduleRender({ full: true }),
});

const server = listen(handler, { port: PORT, usbHost: USB_HOST, retryMs: USB_BIND_RETRY_MS });
scheduleRender({ full: true });

// The clock in the top bar, and the link lamp going dark when the Kindle stops
// polling: one partial frame a minute, on the minute.
function tickMinute() {
  setTimeout(() => { scheduleRender(); tickMinute(); }, 60_000 - (Date.now() % 60_000) + 50);
}
tickMinute();

// The Kindle dropping off: whatever it was holding goes back to the terminal
// now rather than at the ten-minute timeout.
let wasLinked = false;
setInterval(() => {
  const now = linked();
  if (wasLinked && !now) {
    const n = claude.releasePermissions('unlinked');
    log('--', `Kindle gone${n ? `, ${n} permission(s) back to the terminal` : ''}`);
    scheduleRender();
  }
  wasLinked = now;
}, 2_000).unref();

async function shutdown() {
  log('--', 'shutting down');
  claude.releasePermissions('shutdown');
  claude.stop();
  await server.close();
  await renderer.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
