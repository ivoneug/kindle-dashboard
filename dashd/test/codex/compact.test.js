import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { createCompactions } from '../../src/codex/compactions.js';
import { createDesktopControl, desktopIdle, desktopTurns } from '../../src/codex/desktop.js';
import { createUi } from '../../src/ui.js';
import { parseKey } from '../../src/keys.js';
import { canCompactFrame } from '../../src/session-actions.js';

const flush = () => new Promise((r) => setImmediate(r));
function fixture(t, options = {}) {
  const state = { id: 'chat', threadRuntimeStatus: { type: 'active' }, requests: [], turns: [] };
  const watch = { state, events: new EventEmitter(), calls: 0, closed: 0,
    async compact() { this.calls++; if (options.error) throw options.error; return {}; },
    close() { this.closed++; this.events.removeAllListeners(); } };
  const opened = [];
  const manager = createCompactions({ control: { async openThread(id) { opened.push(id); return watch; } }, retryMs: 10,
    ...options });
  t.after(() => manager.stop());
  return { manager, watch, state, opened, update() { watch.events.emit('state', state); } };
}
const compactTurn = (status = 'completed') => ({ turnId: 'compact-turn', status, turnStartedAtMs: Date.now(),
  items: [{ type: 'contextCompaction', source: 'manual' }] });

test('compact waits for work and approvals, deduplicates C and requires a completed compaction event', async (t) => {
  const { manager: m, watch: w, state: s, update, opened } = fixture(t);
  assert.equal(m.request('chat'), 'queued'); assert.equal(m.request('chat'), 'queued');
  await flush(); assert.deepEqual(opened, ['chat']); assert.equal(w.calls, 0);
  s.threadRuntimeStatus.type = 'idle'; s.requests = [{ method: 'approval' }]; update();
  assert.equal(w.calls, 0, 'an outstanding answer prevents compaction even while idle');
  s.requests = []; update(); await flush();
  assert.equal(w.calls, 1); assert.equal(m.request('chat'), 'running');
  assert.equal(m.snapshot().chat.status, 'running', 'RPC acceptance is not completion');
  s.turns = [compactTurn('inProgress')]; update(); assert.equal(m.snapshot().chat.status, 'running');
  s.turns[0].status = 'completed'; update();
  assert.equal(m.snapshot().chat.status, 'done'); assert.equal(w.closed, 1); assert.equal(w.calls, 1);
});

test('idle compact starts immediately and never mistakes an old or automatic compaction for success', async (t) => {
  const { manager: m, watch: w, state: s, update } = fixture(t);
  s.threadRuntimeStatus.type = 'idle'; s.turns = [{ ...compactTurn(), turnId: 'old' }];
  m.request('chat'); await flush(); assert.equal(w.calls, 1);
  update(); assert.equal(m.snapshot().chat.status, 'running');
  s.turns.push({ ...compactTurn(), turnId: 'auto', items: [{ type: 'contextCompaction', source: 'auto' }] }); update();
  assert.equal(m.snapshot().chat.status, 'running');
  s.turns.push(compactTurn('failed')); update(); assert.equal(m.snapshot().chat.status, 'failed');
});

test('an uncertain send is not retried, and a later completed event resolves the uncertainty', async (t) => {
  const { manager: m, watch: w, state: s, update } = fixture(t, { error: Object.assign(new Error('timeout'), { uncertain: true }) });
  s.threadRuntimeStatus.type = 'idle'; m.request('chat'); await flush();
  assert.equal(m.snapshot().chat.status, 'unknown'); assert.equal(m.request('chat'), 'unknown');
  await new Promise(r => setTimeout(r, 35)); assert.equal(w.calls, 1);
  s.turnHistory = { kind: 'canonical', history: { entitiesByKey: { fresh: compactTurn() } } }; update();
  assert.equal(m.snapshot().chat.status, 'done');
});

test('queued jobs survive restart; previously sent jobs are observed without resubmitting', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-compact-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'jobs.json');
  const first = fixture(t, { file }); first.manager.request('chat'); await flush(); first.manager.stop();
  const second = fixture(t, { file }); second.state.threadRuntimeStatus.type = 'idle';
  await new Promise(r => setTimeout(r, 25)); assert.equal(second.watch.calls, 1); second.manager.stop();
  const third = fixture(t, { file }); third.state.threadRuntimeStatus.type = 'idle';
  await new Promise(r => setTimeout(r, 25)); assert.equal(third.watch.calls, 0); assert.equal(third.manager.snapshot().chat.status, 'unknown');
  third.state.turns = [compactTurn()]; third.update(); assert.equal(third.manager.snapshot().chat.status, 'done');
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), []);
});

test('a chat without a live owner stays queued and starts only when its owner becomes available', async (t) => {
  let available = false, calls = 0;
  const watch = { state: { id: 'chat', threadRuntimeStatus: { type: 'idle' }, requests: [], turns: [] },
    events: new EventEmitter(), async compact() { calls++; }, close() { this.events.removeAllListeners(); } };
  const m = createCompactions({ retryMs: 10, control: { async openThread() {
    if (!available) throw new Error('no-client-found'); return watch;
  } } }); t.after(() => m.stop());
  m.request('chat'); await flush();
  assert.equal(m.snapshot().chat.status, 'queued'); assert.equal(calls, 0);
  assert.match(m.snapshot().chat.reason, /Open this chat/);
  available = true; await new Promise(r => setTimeout(r, 25));
  assert.equal(m.snapshot().chat.status, 'running'); assert.equal(calls, 1);
});

test('a request that cannot be saved never reaches Codex', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-compact-write-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parent = path.join(dir, 'not-a-directory'); fs.writeFileSync(parent, 'file');
  let opened = 0;
  const m = createCompactions({ file: path.join(parent, 'jobs.json'), control: { async openThread() { opened++; } } });
  t.after(() => m.stop());
  assert.throws(() => m.request('chat'), /Cannot save/); assert.equal(opened, 0); assert.deepEqual(m.snapshot(), {});
});

test('C targets the displayed selected session in both screens; Ambient, Queue and stale targets cannot compact', () => {
  assert.equal(parseKey('46 1').action, 'compact'); assert.equal(parseKey('46 0').press, false);
  const ui = createUi(), ctx = { sessions: [{ id: 'a' }, { id: 'b' }], asks: [], orientation: 'portrait' };
  ui.act('down', ctx); assert.equal(ui.act('compact', ctx).compact, 'b');
  ui.act('open', ctx); assert.equal(ui.act('compact', ctx).compact, 'b');
  for (const screen of ['sessions', 'detail']) {
    const frame = { meta: { screen, sessionId: 'b' } };
    assert.equal(canCompactFrame(frame, 'b'), true); assert.equal(canCompactFrame(frame, 'a'), false);
  }
  assert.equal(canCompactFrame(null, 'b'), false); assert.equal(canCompactFrame({ meta: { screen: 'queue', sessionId: 'b' } }, 'b'), false);
  ui.act('screen:queue', ctx); assert.equal(ui.act('compact', ctx).compact, undefined);
  const empty = createUi(); assert.equal(empty.act('compact', { ...ctx, sessions: [] }).compact, undefined);
  // The general wake behavior applies to C too.
  let time = 0; const ambient = createUi({ ambientAfterMs: 1, now: () => time });
  time = 2; ambient.syncAmbient({ sessions: [], asks: [], healthy: true });
  assert.equal(ambient.screen, 'ambient'); assert.equal(ambient.act('compact', ctx).compact, undefined);
  time = 5; ambient.syncAmbient({ sessions: [], asks: [], healthy: true, pendingWork: true });
  time = 10; assert.equal(ambient.syncAmbient({ sessions: [], asks: [], healthy: true, pendingWork: true }), false);
  assert.notEqual(ambient.screen, 'ambient', 'queued or uncertain compact must remain visible');
});

test('desktop adapter uses owner routing, framed UTF-8 and state revisions without claiming ownership', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-desktop-')); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, 'ipc'), { mode: 0o700 });
  const received = [], sockets = new Set(); let peer;
  const send = (message) => { const data = Buffer.from(JSON.stringify(message)), frame = Buffer.alloc(4 + data.length);
    frame.writeUInt32LE(data.length); data.copy(frame, 4); peer.write(frame.subarray(0, 3)); peer.write(frame.subarray(3)); };
  const server = net.createServer((socket) => {
    peer = socket; sockets.add(socket); socket.on('close', () => sockets.delete(socket)); let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while(buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
        const n = buffer.readUInt32LE(0), m = JSON.parse(buffer.subarray(4, 4 + n)); buffer = buffer.subarray(4 + n); received.push(m);
        if(m.type === 'request') send({ type: 'response', requestId: m.requestId, resultType: 'success', handledByClientId: 'owner',
          result: m.method === 'initialize' ? { clientId: 'kindle' } : {} });
        if(m.method === 'thread-stream-following-changed' && m.params.following) send({type:'broadcast', method:'thread-stream-state-changed', sourceClientId:'owner', version:11,
          params:{hostId:'local',conversationId:'chat',change:{type:'snapshot',revision:1,conversationState:{id:'chat',title:'Кириллица',threadRuntimeStatus:{type:'idle'},requests:[],turns:[]}}}});
      }
    });
  });
  await new Promise(r => server.listen(path.join(home, 'ipc', 'ipc.sock'), r));
  t.after(async () => { for(const socket of sockets)socket.destroy(); await new Promise(r=>server.close(r)); });
  const watch = await createDesktopControl({home,timeoutMs:200}).openThread('chat'); t.after(()=>watch.close());
  assert.equal(watch.state.title, 'Кириллица'); assert.equal(desktopIdle(watch.state), true);
  await watch.compact();
  assert.deepEqual(received.filter(m=>m.type==='request').map(m=>m.method), ['initialize','thread-owner-discovery','thread-follower-compact-thread']);
  assert.equal(received.find(m=>m.method==='thread-follower-compact-thread').targetClientId, 'owner');
  const changed = new Promise(r => watch.events.once('state', r));
  send({type:'broadcast',method:'thread-stream-state-changed',sourceClientId:'owner',version:11,params:{hostId:'local',conversationId:'chat',change:{type:'patches',baseRevision:1,revision:2,
    patches:[{op:'replace',path:['threadRuntimeStatus','type'],value:'active'},{op:'add',path:['turns',0],value:compactTurn('inProgress')}]}}});
  await changed; assert.equal(desktopIdle(watch.state), false); assert.equal(desktopTurns(watch.state).length, 1);
  const lost = new Promise(r => watch.events.once('disconnect', r));
  send({type:'broadcast',method:'thread-stream-state-changed',sourceClientId:'owner',version:11,params:{hostId:'local',conversationId:'chat',change:{type:'patches',baseRevision:0,revision:3,patches:[]}}});
  assert.match((await lost).message, /out of sync/);
});
