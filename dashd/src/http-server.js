// Kindle-facing HTTP API (kindle-dashboard.md §5.4). Shell-friendly: plain GETs,
// answers in the body, no headers the client has to read.
//
//   GET /version?since=N    long-poll; "N" or "N full" (full = refresh fully)
//   GET /frame.png?v=N      the frame of version N (current if v is absent)
//   GET /key?code=K&v=N     a key press; v = version on the Kindle's screen
//
// Claude Code, loopback only (installed by scripts/install-hooks.js):
//   POST /hook, /hook/<event>   hook payloads; PermissionRequest is held open
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
import { log } from './log.js';

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
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const q = url.searchParams;
    const local = isLoopback(req.socket.remoteAddress);

    // Hooks can hold and answer permission prompts, so they come from this
    // Mac only — never from the Kindle's side of the cable.
    if (req.method === 'POST' && (url.pathname === '/hook' || url.pathname.startsWith('/hook/'))) {
      if (!local || !app.onHook) return text(res, 404, 'not found');
      let payload = {};
      try { payload = JSON.parse(await readBody(req) || '{}'); } catch {}
      // Bare /hook is the type:"http" form: the event rides in the payload.
      const event = url.pathname === '/hook'
        ? (payload.hook_event_name || 'unknown')
        : url.pathname.slice('/hook/'.length);
      return app.onHook(event, payload, res);
    }

    if (req.method !== 'GET') return text(res, 405, 'method not allowed');

    switch (url.pathname) {
      case '/version': {
        if (app.onPoll) app.onPoll(local);
        const since = intParam(q, 'since');
        const wait = app.frames.waitForChange(since, app.longPollMs);
        // res, not req: a GET's request side can count as closed before the
        // client is gone.
        res.on('close', wait.abort);
        const s = await wait.promise;
        if (res.writableEnded || res.destroyed) return;
        return text(res, 200, s.full ? `${s.version} full` : String(s.version));
      }
      case '/frame.png': {
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

// Loopback always; the USB address when it exists. Unplugged cable = no such
// address yet, so keep retrying instead of failing startup.
export function listen(handler, { port, usbHost, retryMs }) {
  const servers = [];
  let warned = false;

  function bind(host, { retry }) {
    const server = http.createServer(handler);
    // Long-polls are held open on purpose; Node's default request timeout
    // must not cut them.
    server.requestTimeout = 0;
    server.on('error', (err) => {
      if (retry && err.code === 'EADDRNOTAVAIL') {
        if (!warned) log('!!', `${host} not on any interface yet (USB network down?) — retrying every ${retryMs / 1000}s`);
        warned = true;
        setTimeout(() => bind(host, { retry }), retryMs).unref();
        return;
      }
      log('!!', `listen ${host}:${port}: ${err.message}`);
      process.exitCode = 1;
    });
    server.listen(port, host, () => {
      log('--', `listening on http://${host}:${port}`);
      servers.push(server);
    });
  }

  bind('127.0.0.1', { retry: false });
  if (usbHost && !isLoopback(usbHost)) bind(usbHost, { retry: true });

  return {
    close: () => Promise.all(servers.map((s) => new Promise((r) => {
      s.closeAllConnections();
      s.close(r);
    }))),
  };
}
