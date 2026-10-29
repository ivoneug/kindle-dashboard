import fs from 'node:fs';
import path from 'node:path';
import { createDesktopControl, desktopIdle, desktopTurns } from './desktop.js';

const ACTIVE = new Set(['queued', 'running', 'unknown']);
const turnId = (turn) => turn.turnId || turn.id;

export function createCompactions({ control = createDesktopControl(), file, onChange = () => {}, now = Date.now,
  retryMs = 5000, runningTimeoutMs = 10 * 60_000 } = {}) {
  const jobs = new Map(), watches = new Map(), opening = new Set();
  let stopped = false;
  if (file) {
    try {
      for (const j of JSON.parse(fs.readFileSync(file, 'utf8'))) {
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(j.id) || !ACTIVE.has(j.status) || !Number.isFinite(j.requestedTs)) continue;
        jobs.set(j.id, { ...j, status: j.status === 'running' ? 'unknown' : j.status });
      }
    } catch {}
  }
  function save() {
    if (!file) return;
    const temp = file + '.tmp';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify([...jobs.values()].filter((j) => ACTIVE.has(j.status))), { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  function changed() { save(); onChange(); }
  function close(id) { const w = watches.get(id); watches.delete(id); w?.close(); }
  function finish(job, status, reason) {
    Object.assign(job, { status, finishedTs: now(), reason }); close(job.id); changed();
  }
  function observe(job, watch) {
    if (stopped || watches.get(job.id) !== watch) return;
    if (job.status === 'queued') {
      if (!desktopIdle(watch.state)) return;
      job.beforeTurnIds = desktopTurns(watch.state).map(turnId);
      job.startedTs = now(); job.status = 'running';
      // Persist before sending: a timeout/restart must never submit twice.
      try { changed(); } catch { return finish(job, 'failed', 'Cannot save compact request'); }
      watch.compact().then(() => {
        if (!stopped && ACTIVE.has(job.status)) { job.accepted = true; changed(); observe(job, watch); }
      }).catch((e) => {
        if (stopped || !ACTIVE.has(job.status)) return;
        if (e.uncertain) { job.status = 'unknown'; job.reason = 'Check compact status in Codex'; changed(); }
        else finish(job, 'failed', 'Codex rejected compact');
      });
      return;
    }
    if (job.status !== 'running' && job.status !== 'unknown') return;
    const turns = desktopTurns(watch.state).filter((t) => !(job.beforeTurnIds || []).includes(turnId(t)) &&
      t.turnStartedAtMs >= job.startedTs - 1000 && t.items.some((i) => i.type === 'contextCompaction' && (i.source == null || i.source === 'manual')));
    const turn = turns.find((t) => turnId(t) === job.compactTurnId) || turns[0];
    if (turn) {
      job.compactTurnId = turnId(turn);
      if (turn.status === 'completed') return finish(job, 'done');
      if (turn.status === 'failed' || turn.status === 'interrupted') return finish(job, 'failed', 'Compact did not complete');
      if (job.status !== 'running') { job.status = 'running'; changed(); }
    }
    if (job.status === 'running' && now() - job.startedTs > runningTimeoutMs) {
      job.status = 'unknown'; job.reason = 'Check compact status in Codex'; changed();
    }
  }
  async function connect(job) {
    if (stopped || !ACTIVE.has(job.status) || watches.has(job.id) || opening.has(job.id)) return;
    opening.add(job.id);
    try {
      const watch = await control.openThread(job.id);
      if (stopped || !ACTIVE.has(job.status)) { watch.close(); return; }
      watches.set(job.id, watch);
      if (job.status === 'queued' && job.reason) { delete job.reason; changed(); }
      watch.events.on('state', () => observe(job, watch));
      watch.events.on('disconnect', () => {
        if (watches.get(job.id) !== watch) return;
        watches.delete(job.id);
        if (job.status === 'running') job.status = 'unknown';
        job.reason = 'Codex desktop disconnected'; changed();
      });
      observe(job, watch);
    } catch (e) {
      if (!stopped && ACTIVE.has(job.status)) {
        if (/Unsupported|Invalid|Untrusted|out of sync|mismatch/.test(e.message)) finish(job, 'failed', 'Codex desktop protocol is incompatible');
        else if (job.reason !== 'Open this chat in Codex') { job.reason = 'Open this chat in Codex'; changed(); }
      }
    } finally { opening.delete(job.id); }
  }
  function tick() {
    for (const job of jobs.values()) {
      if (job.status === 'queued' && now() - job.requestedTs > 24 * 3600_000) finish(job, 'failed', 'Queued compact expired');
      else if (ACTIVE.has(job.status)) {
        const watch = watches.get(job.id);
        if (watch) observe(job, watch); else void connect(job);
      }
    }
  }
  const timer = setInterval(tick, retryMs); timer.unref();
  return {
    request(id) {
      const existing = jobs.get(id);
      if (existing && ACTIVE.has(existing.status)) return existing.status;
      const job = { id, status: 'queued', requestedTs: now() }; jobs.set(id, job);
      try { changed(); } catch { jobs.delete(id); throw new Error('Cannot save compact request'); }
      void connect(job); return 'queued';
    },
    snapshot: () => Object.fromEntries([...jobs].map(([id, j]) => [id, { ...j }])),
    stop() { stopped = true; clearInterval(timer); for (const id of watches.keys()) close(id); },
  };
}
