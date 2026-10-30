import fs from 'node:fs';
import { createSlackApi } from './api.js';
import { compareTs, validTs, normalizeMessage, normalizeReply } from './messages.js';
import { createSlackUpdates } from './updates.js';

export function readSlackToken(file, env = process.env) {
  if (env.DASHD_SLACK_TOKEN) return env.DASHD_SLACK_TOKEN.trim();
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

export function createSlack({ token = '', channelId = '', channelName = 'twk-support', pollMs = 10_000,
  api = createSlackApi({ token }), onChange = () => {}, now = Date.now, autoStart = true, updatesFile, onReadStateError } = {}) {
  const state = { configured: !!(token && channelId), channelId, channelName, messages: [], users: {}, threads: {},
    loading: false, error: '', updatedTs: null, hasMore: false, unreadCount: 0 };
  const updates = createSlackUpdates({ file: updatesFile, channelId, now, onError: onReadStateError });
  state.unreadCount = updates.unreadCount;
  let stopped = false, timer = null, polling = null, cursor = '', more = null, selectedThread = null, retryAt = 0, paged = false, olderLatest = null, readRetryAt = 0;
  const userAttempts = new Set(), threadLoads = new Map();
  const changed = () => { if (!stopped) onChange(); };
  function refreshUpdates() {
    state.messages = state.messages.map((m) => updates.forMessage(m)).sort((a, b) => compareTs(b.activityTs, a.activityTs) || compareTs(b.id, a.id));
    state.unreadCount = updates.unreadCount;
  }
  function errorCode(e) { return /^[a-z0-9_]+$/.test(e.code) ? e.code : 'connection_failed'; }
  async function initializeReadPosition() {
    if (!updates.needsReadPosition || now() < readRetryAt) return;
    try {
      const { channel } = await api('conversations.info', { channel: channelId });
      if (!stopped) { updates.initializeReadPosition(channel?.last_read); refreshUpdates(); }
    } catch (e) {
      // Reading messages still works if this optional bootstrap request fails.
      readRetryAt = now() + Math.max(pollMs, e.retryMs || 0);
    }
  }
  async function resolveUsers(raw) {
    for (const id of new Set(raw.flatMap((m) => [m.user, ...[...(m.text || '').matchAll(/<@([A-Z0-9]+)>/g)].map((m) => m[1])]).filter(Boolean))) {
      if (userAttempts.has(id) || stopped) continue;
      userAttempts.add(id);
      try {
        const { user } = await api('users.info', { user: id });
        if (!stopped) state.users[id] = user.profile?.display_name || user.real_name || user.name || id;
      } catch { /* Names are optional; message reads can still succeed. */ }
    }
  }
  function merge(raw, replaceNewest = false, range = null) {
    const rows = raw.map((m) => normalizeMessage(m, state.users)).filter(Boolean);
    const oldest = raw.filter((m) => validTs(m.ts)).map((m) => m.ts).sort(compareTs)[0];
    const kept = range ? state.messages.filter((m) => compareTs(m.id, range.latest) > 0 || compareTs(m.id, range.oldest) < 0) :
      replaceNewest ? state.messages.filter((m) => oldest && compareTs(m.id, oldest) < 0) : state.messages;
    const previous = state.messages;
    state.messages = [...new Map([...kept, ...rows].map((m) => [m.id, m])).values()];
    updates.observe(rows);
    const ids = new Set(state.messages.map((m) => m.id));
    updates.remove(previous.filter((m) => !ids.has(m.id)).map((m) => m.id));
    refreshUpdates();
  }
  // Replies do not move a root into conversations.history's newest page.
  // Refresh one older loaded page per poll, rotating through the loaded range.
  async function refreshOlder(head) {
    if (!paged || !head.length || !state.messages.length) return;
    const boundary = head.filter((m) => validTs(m.ts)).map((m) => m.ts).sort(compareTs)[0];
    const oldest = state.messages.map((m) => m.id).sort(compareTs)[0];
    if (!boundary || compareTs(oldest, boundary) >= 0) return;
    const latest = olderLatest && compareTs(olderLatest, boundary) < 0 && compareTs(olderLatest, oldest) > 0 ? olderLatest : boundary;
    const data = await api('conversations.history', { channel: channelId, limit: 100, latest, oldest, inclusive: true });
    if (stopped) return;
    const raw = data.messages || [], end = raw.filter((m) => validTs(m.ts)).map((m) => m.ts).sort(compareTs)[0];
    const hasMore = !!(data.has_more || data.response_metadata?.next_cursor);
    merge(raw, false, { latest, oldest: hasMore && end ? end : oldest });
    olderLatest = hasMore && end && compareTs(end, latest) < 0 ? end : null;
    await resolveUsers(raw);
  }
  async function restoreUnread() {
    const loaded = new Set(state.messages.map((m) => m.id));
    const id = updates.unreadIds.find((id) => !loaded.has(id));
    if (!id) return;
    try {
      const data = await api('conversations.replies', { channel: channelId, ts: id, limit: 1 });
      if (!stopped) merge((data.messages || []).filter((m) => m.ts === id));
    } catch (e) {
      if (e.code !== 'thread_not_found' && e.code !== 'message_not_found') throw e;
      updates.remove([id]); refreshUpdates();
    }
  }
  async function loadThread(id, force = false) {
    if (!state.configured || !validTs(id) || stopped) return;
    if (threadLoads.has(id)) return threadLoads.get(id);
    if (!force && state.threads[id]?.updatedTs && now() - state.threads[id].updatedTs < pollMs) return;
    const old = state.threads[id];
    if (old?.retryAt > now()) return;
    state.threads[id] = { ...old, messages: old?.messages || [], loading: true, error: '' }; changed();
    const task = (async () => {
      try {
        const all = [], cursors = new Set(); let next = '';
        do {
          const data = await api('conversations.replies', { channel: channelId, ts: id, limit: 100, cursor: next });
          if (stopped) return;
          all.push(...data.messages || []); next = data.response_metadata?.next_cursor || '';
          if (next && cursors.has(next)) throw new Error('repeated_cursor');
          cursors.add(next);
        } while (next && !stopped);
        await resolveUsers(all); if (stopped) return;
        state.threads[id] = { messages: [...new Map(all.map((m) => normalizeReply(m, state.users)).filter(Boolean).map((m) => [m.id, m])).values()]
          .sort((a, b) => compareTs(a.id, b.id)), loading: false, error: '', updatedTs: now() };
        const root = state.threads[id].messages.find((m) => m.id === id);
        if (root) {
          const replies = state.threads[id].messages.filter((m) => m.id !== id);
          const current = { ...root, latestReply: replies.at(-1)?.id || null, replyCount: replies.length };
          state.messages = state.messages.map((m) => m.id === id ? current : m);
          updates.observe([current]); refreshUpdates();
        }
      } catch (e) {
        if (!stopped) state.threads[id] = { ...state.threads[id], loading: false, error: errorCode(e), retryAt: now() + Math.max(pollMs, e.retryMs || 0) };
      } finally { threadLoads.delete(id); changed(); }
    })();
    threadLoads.set(id, task); return task;
  }
  async function poll() {
    if (!state.configured || stopped || now() < retryAt) return;
    if (more) return more;
    if (polling) return polling;
    state.loading = !state.updatedTs; changed();
    polling = (async () => {
      try {
        await initializeReadPosition(); if (stopped) return;
        const data = await api('conversations.history', { channel: channelId, limit: 100 });
        if (stopped) return;
        const raw = data.messages || [];
        merge(raw, true); state.error = ''; state.loading = false; state.updatedTs = now();
        // Once older pages are loaded, retain their cursor across head refreshes.
        if (!paged) cursor = data.response_metadata?.next_cursor || '';
        state.hasMore = !!cursor; changed();
        await resolveUsers(raw); if (stopped) return;
        await restoreUnread(); if (stopped) return;
        await refreshOlder(raw); if (stopped) return;
        state.messages = state.messages.map((m) => ({ ...m, author: state.users[m.user] || m.author }));
        if (selectedThread) await loadThread(selectedThread, true);
      } catch (e) { if (!stopped) { state.error = errorCode(e); retryAt = now() + Math.max(pollMs, e.retryMs || 0); } }
      finally { state.loading = false; polling = null; changed(); }
    })();
    return polling;
  }
  async function loadMore() {
    if (polling) await polling;
    if (!cursor || more || stopped) return more;
    more = (async () => {
      try {
        const data = await api('conversations.history', { channel: channelId, limit: 100, cursor });
        if (stopped) return;
        await resolveUsers(data.messages || []); if (stopped) return;
        merge(data.messages || []); cursor = data.response_metadata?.next_cursor || ''; paged = true; state.hasMore = !!cursor; state.error = '';
      } catch (e) { if (!stopped) state.error = errorCode(e); }
      finally { more = null; changed(); }
    })(); return more;
  }
  async function tick() { await poll(); if (!stopped) { timer = setTimeout(tick, pollMs); timer.unref(); } }
  if (autoStart && state.configured) { timer = setTimeout(tick, 0); timer.unref(); }
  return { state, poll, loadMore, loadThread,
    acknowledge(read) { if (updates.acknowledge(read)) { refreshUpdates(); changed(); } },
    selectThread(id) { selectedThread = id; if (id) void loadThread(id); },
    status: () => ({ configured: state.configured, channel: state.channelName, messages: state.messages.length, unreadCount: state.unreadCount, error: state.error || null, updatedTs: state.updatedTs }),
    stop() { stopped = true; clearTimeout(timer); },
  };
}
