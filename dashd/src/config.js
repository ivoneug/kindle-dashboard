import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DASHD_ROOT = path.resolve(__dirname, '..');

// File config first (dashd/.config.json), env on top for one-off runs and tests.
const CONFIG_FILE = process.env.DASHD_CONFIG || path.join(DASHD_ROOT, '.config.json');
let fileConfig = {};
try { fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}

const pick = (env, key, fallback) => process.env[env] ?? fileConfig[key] ?? fallback;

export const PORT = Number(pick('DASHD_PORT', 'port', 8765));

// The Mac's end of the USB network link. dashd listens here and on loopback,
// never on 0.0.0.0: /key will approve tool calls, so the only peers allowed
// to reach it are this Mac and the Kindle on the other end of the cable.
// The default is the USBNetwork hack's own K3 default (HOST_IP in
// /mnt/us/usbnet/etc/config). Must not sit inside the home LAN's subnet: this
// Mac's Wi-Fi is on 192.168.1.0/24.
export const USB_HOST = String(pick('DASHD_USB_HOST', 'usbHost', '192.168.2.1'));
// While the cable is out the address does not exist and bind fails; retry.
export const USB_BIND_RETRY_MS = 5_000;

// The K3 panel is 600×800 and eips draws in that orientation. A landscape
// frame is laid out at 800×600 and turned onto the panel; which way depends on
// which side the keyboard ends up on (90 = clockwise).
export const PANEL = { width: 600, height: 800 };
export const ORIENTATION = String(pick('DASHD_ORIENTATION', 'orientation', 'portrait'));
export const LANDSCAPE_ROTATE = Number(pick('DASHD_LANDSCAPE_ROTATE', 'landscapeRotate', 90));

// e-ink refresh policy: a partial update leaves ghosts, so every Nth frame is
// a full (flashing) one even if nothing asked for it.
export const FULL_EVERY = Number(pick('DASHD_FULL_EVERY', 'fullEvery', 10));
// Frames kept around for /frame.png?v=N — a client that is a few versions
// behind still gets the frame it asked for.
export const KEEP_FRAMES = 4;

// /version holds the request this long when nothing changed. Busybox wget may
// have no read timeout of its own, so the server is the one that lets go.
export const LONG_POLL_MS = Number(pick('DASHD_LONG_POLL_MS', 'longPollMs', 25_000));
// Bursts of state changes collapse into one frame; e-ink can't show more than
// about one per second anyway.
export const RENDER_DEBOUNCE_MS = Number(pick('DASHD_RENDER_DEBOUNCE_MS', 'renderDebounceMs', 400));
// Busy sessions change the Sessions screen with every tool call — several
// times a second. Frames driven by those events come no closer together than
// this; a key press is answered at once regardless.
export const MIN_FRAME_INTERVAL_MS = Number(pick('DASHD_MIN_FRAME_INTERVAL_MS', 'minFrameIntervalMs', 3_000));
// The Kindle counts as connected while it has polled this recently.
export const LINK_ALIVE_MS = LONG_POLL_MS + 10_000;

// Headless Chrome for rendering: the installed Google Chrome by default, so
// there is no separate browser download. An explicit binary wins.
export const CHROME_CHANNEL = String(pick('DASHD_CHROME_CHANNEL', 'chromeChannel', 'chrome'));
export const CHROME_PATH = pick('DASHD_CHROME_PATH', 'chromePath', '') || undefined;
