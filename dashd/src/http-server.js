// Kindle-facing HTTP API (kindle-dashboard.md §5.4). Shell-friendly: plain GETs,
// answers in the body, no headers the client has to read.
//
//   GET /version?since=N    long-poll; "N" or "N full" (full = refresh fully)
//   GET /frame.png?v=N      the frame of version N (current if v is absent)
//   GET /key?code=K&v=N     a key press; v = version on the Kindle's screen
//
// Agent hooks, loopback only:
//   POST /hook, /hook/<event>   Claude Code hooks
//   POST /codex/hook           Codex command hooks; PermissionRequest is held open
//   GET /status                 JSON health: sessions, held asks, hooks
//
// Development routes, loopback only:
//   GET /                   preview: the current frame plus simulated keys
//   GET /dev/state          JSON for the preview page
//   GET /dev/set?orientation=portrait|landscape
//   GET /dev/refresh        re-render with a full refresh

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { log } from './log.js';
import { validateNetwork } from './network.js';
import { parseBattery } from './battery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREVIEW_HTML = path.join(__dirname, 'preview.html');

export function isLoopback(addr) {
  if (!addr) return false;
  const v4 = addr.startsWith('::ffff:') ? addr.slice(7) : addr;
  return v4 === '::1' || v4.startsWith('127.');
}

function text(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  res.end(body + '\n');
}

function json(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function intParam(q, name) {
  const n = parseInt(q.get(name), 10);
  return Number.isFinite(n) ? n : 0;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// app: { frames, longPollMs, onKey({code, v, stale, local}), onPoll(),
//        onHook(event, payload, res), status(),
//        devState(), devSet(params), devRefresh() }
export function createHandler(app) {
  validateNetwork(app);
  return async function handle(req, res) {
    let url;
    try { url = new URL(req.url, 'http://x'); }
    catch { return text(res, 400, 'invalid URL'); }
    const q = url.searchParams;
    const local = isLoopback(req.socket.remoteAddress);

    // Hooks can hold and answer permission prompts, so they come from this
    // Mac only — never from the Kindle's side of the cable.
    const codexHook = url.pathname === '/codex/hook';
    if (req.method === 'POST' && (codexHook || url.pathname === '/hook' || url.pathname.startsWith('/hook/'))) {
      if (!local || !app.onHook) return text(res, 404, 'not found');
      let payload = {};
      try { payload = JSON.parse(await readBody(req) || '{}'); } catch {}
      // Bare /hook is the type:"http" form: the event rides in the payload.
      const event = codexHook || url.pathname === '/hook'
        ? (payload.hook_event_name || 'unknown')
        : url.pathname.slice('/hook/'.length);
      return app.onHook(event, payload, res, codexHook ? 'codex' : 'claude');
    }

    if (req.method !== 'GET') return text(res, 405, 'method not allowed');

    // The old Kindle wget cannot send custom headers. The shared secret rides
    // in the query, is never logged, and gates all three device routes before
    // a poll can mark the Kindle linked or a key can answer a permission.
    if (!local && app.deviceToken && ['/version', '/frame.png', '/key'].includes(url.pathname)) {
      const tokens = q.getAll('token');
      const supplied = Buffer.from(tokens.length === 1 ? tokens[0] : '');
      const expected = Buffer.from(app.deviceToken);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        return text(res, 403, 'forbidden');
      }
    }

    switch (url.pathname) {
      case '/version': {
        if (!local && app.onBattery && q.getAll('battery').length === 1 && q.getAll('charging').length === 1) {
          const battery = parseBattery(q.get('battery'), q.get('charging'));
          if (battery) app.onBattery(battery);
        }
        if (app.onPoll) app.onPoll(local, { address: req.socket.remoteAddress, host: req.socket.localAddress });
        const newEpoch = q.has('epoch') && q.get('epoch') !== app.frames.epoch;
        const since = newEpoch ? 0 : intParam(q, 'since');
        // The client advances since only after eips succeeds. Merely rendering
        // or downloading a preview must not clear unread notifications.
        const shown = !local && q.get('epoch') === app.frames.epoch && app.frames.get(since);
        if (shown && app.onShown) app.onShown(shown);
        const wait = app.frames.waitForChange(since, app.longPollMs);
        // res, not req: a GET's request side can count as closed before the
        // client is gone.
        res.on('close', wait.abort);
        const s = await wait.promise;
        if (res.writableEnded || res.destroyed) return;
        // Preserve the two-field response for legacy clients.
        const epoch = q.has('epoch') ? ` epoch=${app.frames.epoch}` : '';
        return text(res, 200, (s.full ? `${s.version} full` : String(s.version)) + epoch);
      }
      case '/frame.png': {
        if (q.has('epoch') && q.get('epoch') !== app.frames.epoch) return text(res, 409, 'daemon restarted');
        const v = q.has('v') ? intParam(q, 'v') : app.frames.version;
        const f = app.frames.get(v);
        if (!f) return text(res, 404, 'no such frame');
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': f.png.length, 'Cache-Control': 'no-store' });
        return res.end(f.png);
      }
      case '/key': {
        const code = (q.get('code') || '').trim();
        if (!code) return text(res, 400, 'missing code');
        const v = intParam(q, 'v');
        const stale = v !== app.frames.version;
        if (q.has('epoch') && q.get('epoch') !== app.frames.epoch) return text(res, 409, 'stale daemon');
        app.onKey({ code, v, stale, local });
        return text(res, 200, stale ? 'stale' : 'ok');
      }
    }

    if (!local) return text(res, 404, 'not found');

    switch (url.pathname) {
      case '/':
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(PREVIEW_HTML));
      case '/status':
        return json(res, app.status ? app.status() : {});
      case '/dev/state':
        return json(res, app.devState());
      case '/dev/set':
        app.devSet(Object.fromEntries(q));
        return json(res, app.devState());
      case '/dev/refresh':
        app.devRefresh();
        return text(res, 200, 'ok');
    }
    return text(res, 404, 'not found');
  };
}

// Bind exact addresses, never 0.0.0.0. Either cable or Wi-Fi can be absent at
// startup; keep retrying those addresses until their interfaces appear.
export function listen(handler, { port, usbHost, lanHost = '', deviceToken = '', retryMs }) {
  validateNetwork({ lanHost, deviceToken });
  const servers = [];
  const retries = new Set();
  const warned = new Set();
  let closing = false;

  function bind(host, { retry }) {
    if (closing) return;
    const server = http.createServer(handler);
    // Long-polls are held open on purpose; Node's default request timeout
    // must not cut them.
    server.requestTimeout = 0;
    server.on('error', (err) => {
      if (retry && err.code === 'EADDRNOTAVAIL') {
        if (closing) return;
        if (!warned.has(host)) log('!!', `${host} not on any interface yet — retrying every ${retryMs / 1000}s`);
        warned.add(host);
        const timer = setTimeout(() => { retries.delete(timer); bind(host, { retry }); }, retryMs).unref();
        retries.add(timer);
        return;
      }
      log('!!', `listen ${host}:${port}: ${err.message}`);
      // A service manager must see the failure and restart, rather than leave
      // a second daemon alive with no loopback listener (e.g. port in use).
      process.exit(1);
    });
    server.listen(port, host, () => {
      if (closing) return server.close();
      log('--', `listening on http://${host}:${port}`);
      servers.push(server);
    });
  }

  bind('127.0.0.1', { retry: false });
  for (const host of new Set([usbHost, lanHost].filter((host) => host && !isLoopback(host)))) bind(host, { retry: true });

  return {
    close() {
      closing = true;
      for (const timer of retries) clearTimeout(timer);
      retries.clear();
      return Promise.all(servers.map((s) => new Promise((r) => {
        s.closeAllConnections();
        s.close(r);
      })));
    },
  };
}
