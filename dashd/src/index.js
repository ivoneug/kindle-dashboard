// dashd: renders e-ink frames on the Mac and serves them to the Kindle K3, and
// runs the Claude Code side (sessions, permission bridge, usage) in-process.
// Still M1's single screen — the test card — redrawn on every key press, on
// Claude events and once a minute for the clock.

import {
  PORT, USB_HOST, USB_BIND_RETRY_MS, PANEL, ORIENTATION, LANDSCAPE_ROTATE,
  FULL_EVERY, KEEP_FRAMES, LONG_POLL_MS, RENDER_DEBOUNCE_MS, LINK_ALIVE_MS,
  CHROME_CHANNEL, CHROME_PATH,
} from './config.js';
import { createRenderer } from './renderer.js';
import { createFrameStore } from './frames.js';
import { createHandler, listen } from './http-server.js';
import { parseKey } from './keys.js';
import { renderTestCard } from './screens/test-card.js';
import { createClaude } from './claude/index.js';
import { MOCK_SESSIONS } from './claude/config.js';
import { log } from './log.js';

const state = {
  orientation: ORIENTATION === 'landscape' ? 'landscape' : 'portrait',
  keys: [],          // newest first
  lastPollTs: 0,     // last /version from the Kindle (not from the preview)
};

const frames = createFrameStore({ fullEvery: FULL_EVERY, keep: KEEP_FRAMES });
const renderer = createRenderer({ channel: CHROME_CHANNEL, executablePath: CHROME_PATH });

function linked() {
  return Date.now() - state.lastPollTs < LINK_ALIVE_MS;
}

// A permission request waits for the Kindle only while one is attached (mock
// mode pretends there is, so the preview can show its scripted asks).
const claude = createClaude({
  onChange: () => scheduleRender(),
  shouldHold: () => linked() || MOCK_SESSIONS,
});

function layout() {
  return state.orientation === 'landscape'
    ? { width: PANEL.height, height: PANEL.width, rotateDeg: LANDSCAPE_ROTATE }
    : { width: PANEL.width, height: PANEL.height, rotateDeg: 0 };
}

// Debounced, single-flight: a burst of changes becomes one frame, and a change
// that lands mid-render queues exactly one more.
let timer = null;
let rendering = false;
let again = false;
let wantFull = false;
let lastLinked = false;

function scheduleRender({ full = false } = {}) {
  wantFull = wantFull || full;
  if (timer) return;
  timer = setTimeout(renderNow, RENDER_DEBOUNCE_MS);
}

async function renderNow() {
  timer = null;
  if (rendering) { again = true; return; }
  rendering = true;
  const full = wantFull;
  wantFull = false;
  try {
    const t0 = Date.now();
    const box = layout();
    lastLinked = linked();
    const html = renderTestCard({
      ...state,
      linked: lastLinked,
      claude: { sessions: claude.state.sessions.length, asks: claude.asks().length },
    }, box);
    const frame = await renderer.render(html, box);
    // Claude events fire far more often than anything on screen changes; an
    // identical frame would still cost the Kindle a redraw.
    const cur = frames.current();
    if (!full && cur && cur.png.equals(frame.png)) return;
    const v = frames.publish(frame.png, { full });
    log('FR', `v${v} ${frame.width}×${frame.height} ${(frame.png.length / 1024).toFixed(0)}KB` +
      `${frames.get(v).full ? ' full' : ''} in ${Date.now() - t0}ms`);
  } catch (err) {
    log('!!', `render failed: ${err.message}`);
  } finally {
    rendering = false;
    if (again) { again = false; scheduleRender(); }
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
    // M1 acts on refresh only; the rest is logged and shown until M2/M3 give
    // them screens to act on.
    scheduleRender({ full: action === 'refresh' });
  },
  onHook: (event, payload, res) => claude.onHook(event, payload, res),
  status: () => ({ ...claude.status(), kindleLinked: linked(), frame: frames.version }),
  devState: () => ({
    version: frames.version,
    orientation: state.orientation,
    linked: linked(),
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
