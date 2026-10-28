// Read-only client of the installed Codex app-server. This process does not
// start/resume turns or take ownership of desktop chats. It reads their stored
// metadata and account limits; runtime activity comes from rollouts and hooks.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { CODEX_BIN } from './config.js';

export function createRpc({ bin = CODEX_BIN, timeoutMs = 12_000 } = {}) {
  let child = null;
  let connecting = null;
  let nextId = 0;
  const pending = new Map();

  function disconnect(error) {
    child = null;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
    pending.clear();
  }

  function send(method, params) {
    if (!child || child.killed) return Promise.reject(new Error('Codex app-server is not connected'));
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex ${method} timed out`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  async function connect() {
    if (connecting) return connecting;
    if (child) return;
    connecting = (async () => {
      const p = child = spawn(bin, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
      // No prompts or tokens are logged by this client. Drain stderr, keep only
      // protocol errors from a failed request as its user-facing explanation.
      p.stderr.resume();
      p.stdin.on('error', () => {});
      p.on('error', (e) => { if (child === p) disconnect(e); });
      p.on('exit', () => { if (child === p) disconnect(new Error('Codex app-server stopped')); });
      readline.createInterface({ input: p.stdout }).on('line', (line) => {
        let m;
        try { m = JSON.parse(line); } catch { return; }
        const waiter = pending.get(m.id);
        if (!waiter) return;
        pending.delete(m.id);
        clearTimeout(waiter.timer);
        if (m.error) waiter.reject(new Error(m.error.message));
        else waiter.resolve(m.result);
      });
      try {
        await send('initialize', { clientInfo: { name: 'kindle_dashboard', title: 'Kindle Dashboard', version: '0.1.0' } });
        p.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
      } catch (e) { p.kill(); throw e; }
    })();
    try { await connecting; } finally { connecting = null; }
  }

  return {
    async request(method, params = {}) {
      // Keep this adapter observational: never let a caller run or resume a
      // thread through a client created only to monitor the user's chats.
      if (!['thread/list', 'thread/read', 'account/rateLimits/read'].includes(method)) {
        throw new Error(`Unsupported dashboard RPC: ${method}`);
      }
      await connect();
      return send(method, params);
    },
    stop() { child?.kill(); disconnect(new Error('Dashboard stopped')); },
  };
}
