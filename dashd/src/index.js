// dashd: renders e-ink frames on the Mac and serves them to the Kindle K3, and
// runs the selected agent backend (Codex by default) in-process.
// Screens: Sessions with the session detail, Queue and Usage, plus the M1 test
// card behind MENU. Permissions are answered from the Queue (M3). A frame
// is rendered on key presses, Claude events and once a minute for the clock,
// and only sent when it differs from the one on screen.

import {
  AGENT, PORT, USB_HOST, LAN_HOST, DEVICE_TOKEN, USB_BIND_RETRY_MS, PANEL, ORIENTATION, LANDSCAPE_ROTATE,
  FULL_EVERY, KEEP_FRAMES, LONG_POLL_MS, RENDER_DEBOUNCE_MS, MIN_FRAME_INTERVAL_MS, LINK_ALIVE_MS,
  CHROME_CHANNEL, CHROME_PATH, AMBIENT_AFTER_MS,
} from './config.js';
import { createRenderer } from './renderer.js';
import { createFrameStore } from './frames.js';
import { createHandler, listen } from './http-server.js';
import { parseKey } from './keys.js';
import { renderTestCard } from './screens/test-card.js';
import { renderSessions } from './screens/sessions.js';
import { renderUsage } from './screens/usage.js';
import { renderDetail } from './screens/detail.js';
import { renderQueue } from './screens/queue.js';
import { renderAmbient } from './screens/ambient.js';
import { createUi, ARM_MS } from './ui.js';
import { createClaude } from './claude/index.js';
import { createCodex } from './codex/index.js';
import { MOCK_SESSIONS } from './claude/config.js';
import { log } from './log.js';

const state = {
  orientation: ORIENTATION === 'landscape' ? 'landscape' : 'portrait',
  keys: [],          // newest first
  lastPollTs: 0,     // last /version from the Kindle (not from the preview)
  lastPollAddress: null,
  lastPollHost: null,
};

const ui = createUi({ ambientAfterMs: AMBIENT_AFTER_MS });
const frames = createFrameStore({ fullEvery: FULL_EVERY, keep: KEEP_FRAMES });
const renderer = createRenderer({ channel: CHROME_CHANNEL, executablePath: CHROME_PATH });

function linked() {
  return Date.now() - state.lastPollTs < LINK_ALIVE_MS;
}

// A permission request waits for the Kindle only while one is attached; with
// none, Claude Code shows its own prompt at once. Mock mode always holds — its
// asks block nobody, and the screens need them.
const backend = AGENT === 'codex' ? createCodex : createClaude;
const agent = backend({
  onChange: onAgentEvent,
  shouldHold: () => (AGENT === 'claude' && MOCK_SESSIONS) || linked(),
});

// A new ask takes the screen (only worth it when someone can see it); the last
// one answered gives it back.
function onAgentEvent(topic) {
  if (topic.endsWith('.permission.request') || topic.endsWith('.question.request')) {
    if ((linked() || (AGENT === 'claude' && MOCK_SESSIONS)) && ui.surfaceQueue()) return scheduleRender({ full: true, urgent: true });
    return scheduleRender({ urgent: true });
  }
  if (topic.endsWith('.permission.resolved') || topic.endsWith('.question.resolved')) {
    if (!agent.asks().length && ui.queueEmptied()) return scheduleRender({ full: true, urgent: true });
    return scheduleRender({ urgent: true });
  }
  if (ui.screen === 'ambient') {
    // Metadata still polls, but a quiet clock needs neither a Chrome render
    // nor a new frame until the minute changes. Real activity wakes at once.
    if (ui.syncAmbient({ sessions: agent.state.sessions, asks: agent.asks(), healthy: !agent.status().error })) {
      scheduleRender({ full: true, urgent: true });
    }
    return;
  }
  scheduleRender();
}

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
    const { html, meta } = screen(box);
    const frame = await renderer.render(html, box);
    if (ui.screen === 'detail' && frame.meta) ui.setMessagePages(frame.meta);
    // Claude events fire far more often than anything on screen changes; an
    // identical frame would still cost the Kindle a redraw.
    const cur = frames.current();
    if (!full && cur && cur.png.equals(frame.png)) return;
    // meta says which ask this frame shows: a Y/N/Back counts only for that one.
    const v = frames.publish(frame.png, { full, meta });
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

// The frame's HTML, plus what dashd must remember about it.
function screen(box) {
  const sessions = agent.state.sessions;
  const asks = agent.asks();
  const view = {
    orientation: state.orientation,
    provider: AGENT,
    linked: lastLinked,
    waiting: asks.length,
    note: ui.note(),
  };
  switch (ui.screen) {
    case 'ambient':
      return { html: renderAmbient({ ...view, sessions: sessions.length }, box) };
    case 'queue': {
      const hero = ui.heroOf(asks);
      const armed = !!hero && ui.isArmed(hero.id);
      return {
        html: renderQueue({ ...view, asks, heroId: hero && hero.id, armed }, box),
        meta: { askId: hero ? hero.id : null, armed },
      };
    }
    case 'detail': {
      const i = sessions.findIndex((s) => s.id === ui.selectedId);
      const d = i >= 0 ? agent.detail(sessions[i].id) : null;
      if (!d) {
        // The session went away under the detail screen.
        ui.leaveDetail();
        return screen(box);
      }
      return { html: renderDetail({ ...view, session: d, index: i, total: sessions.length, msgPage: ui.msgPage }, box) };
    }
    case 'usage':
      return { html: renderUsage({ ...view, usage: agent.state.usage }, box) };
    case 'test':
      return { html: renderTestCard({ ...state, ...view, claude: { sessions: sessions.length, asks: view.waiting } }, box) };
    default:
      return {
        html: renderSessions({
          ...view,
          sessions,
          details: agent.state.details,
          selected: ui.selectedIndex(sessions),
        }, box),
      };
  }
}

const DONE = { allow: 'ALLOWED', deny: 'DENIED', ask: 'SENT TO THE MAC' };

// Y / N / Back on the queue. The press counts only if the frame it was pressed
// on (v) showed this very ask — anything else means the screen changed under
// the finger, and the answer could land on the wrong request. A destructive
// allow needs a second Y, pressed on the frame that asks for it.
function answerAsk({ id, decision, destructive }, v) {
  const shown = frames.get(v);
  if (!shown || !shown.meta || shown.meta.askId !== id) {
    log('PB', `key on v${v} ignored: that frame did not show ${id}`);
    showNote('SCREEN CHANGED — LOOK AGAIN');
    return;
  }
  if (decision === 'allow' && destructive && !(shown.meta.armed && ui.isArmed(id))) {
    ui.arm(id);
    scheduleRender({ urgent: true });
    setTimeout(() => scheduleRender({ urgent: true }), ARM_MS + 100);
    return;
  }
  ui.disarm();
  const ok = agent.answerPermission(id, decision);
  showNote(ok ? DONE[decision] : 'ALREADY ANSWERED');
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
    const r = await agent.focusSession(id);
    if (r && r.focused) showNote('RAISED ' + (r.app || '') + (r.exact ? '' : ' (APP ONLY)'));
    else showNote('CAN\'T RAISE: ' + ((r && r.reason) || 'unknown'));
  } catch (err) {
    showNote('CAN\'T RAISE: ' + err.message);
  }
}

const handler = createHandler({
  frames,
  lanHost: LAN_HOST,
  deviceToken: DEVICE_TOKEN,
  longPollMs: LONG_POLL_MS,
  onPoll(local, peer) {
    if (local) return;
    state.lastPollTs = Date.now();
    state.lastPollAddress = peer.address;
    state.lastPollHost = peer.host;
    // The link lamp lights on the first poll after a gap.
    if (!lastLinked) scheduleRender();
  },
  onKey({ code, v, stale, local }) {
    const { press, name, action } = parseKey(code);
    if (!press) return;
    log('KY', `${code}${name ? ' ' + name : ''} v${v}${stale ? ' stale' : ''}${action ? ' → ' + action : ''}${local ? ' (preview)' : ''}`);
    state.keys = [{ code, name, v, stale, action, ts: Date.now() }, ...state.keys].slice(0, 6);
    if (!action) {
      const r = ui.act('wake', { sessions: agent.state.sessions, asks: agent.asks(), orientation: state.orientation });
      // The test card lists every press; other screens have nothing to show.
      if (r.changed || ui.screen === 'test') scheduleRender({ full: !!r.full, urgent: true });
      return;
    }
    const r = ui.act(action, { sessions: agent.state.sessions, asks: agent.asks(), orientation: state.orientation });
    if (r.focus) raiseTerminal(r.focus);
    if (r.answer) answerAsk(r.answer, v);
    if (r.note) showNote(r.note);
    if (r.changed || ui.screen === 'test') scheduleRender({ full: !!r.full, urgent: true });
  },
  onHook(event, payload, res, provider) {
    if (provider !== AGENT) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{}'); }
    return agent.onHook(event, payload, res);
  },
  status: () => ({
    ...agent.status(), kindleLinked: linked(), frame: frames.version,
    screen: ui.screen,
    kindleAddress: state.lastPollAddress,
    kindleTransport: state.lastPollHost ? (state.lastPollHost === LAN_HOST ? 'wifi' : 'usb') : null,
  }),
  devState: () => ({
    version: frames.version,
    orientation: state.orientation,
    screen: ui.screen,
    linked: linked(),
    sessions: agent.state.sessions.length,
    sessionList: agent.state.sessions,
    selectedId: ui.selectedId,
    waiting: agent.asks().length,
    usage: agent.state.usage,
    provider: AGENT,
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

const server = listen(handler, { port: PORT, usbHost: USB_HOST, lanHost: LAN_HOST, deviceToken: DEVICE_TOKEN, retryMs: USB_BIND_RETRY_MS });
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
  const asks = agent.asks();
  if (ui.syncAmbient({ sessions: agent.state.sessions, asks, healthy: !agent.status().error })) {
    scheduleRender({ full: true, urgent: true });
  }
  const now = linked();
  if (wasLinked && !now) {
    const n = agent.releasePermissions('unlinked');
    log('--', `Kindle gone${n ? `, ${n} permission(s) back to the terminal` : ''}`);
    scheduleRender();
  }
  wasLinked = now;
}, 2_000).unref();

async function shutdown() {
  log('--', 'shutting down');
  agent.releasePermissions('shutdown');
  agent.stop();
  await server.close();
  await renderer.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
