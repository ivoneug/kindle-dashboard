import fs from 'node:fs';
import path from 'node:path';
import { compareTs, validTs } from './messages.js';

export function messageActivity(message) {
  return validTs(message.latestReply) && compareTs(message.latestReply, message.id) > 0 ? message.latestReply : message.id;
}
const count = (n) => Number.isSafeInteger(n) && n >= 0 ? n : 0;
function unread(entry, id) {
  if (compareTs(entry.latestTs, entry.seenTs) <= 0) return 0;
  return Math.max(1, (compareTs(id, entry.seenTs) > 0 ? 1 : 0) + Math.max(0, entry.replyCount - entry.seenReplyCount));
}

// Local read positions only. No Slack read markers or message text are saved.
export function createSlackUpdates({ file, channelId, now = Date.now, onError = () => {} } = {}) {
  const entries = new Map();
  let baseline = null, initialized = false;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if ([1, 2].includes(saved.version) && saved.channelId === channelId && validTs(saved.baseline)) {
      baseline = saved.baseline;
      initialized = saved.version === 2 && saved.initialized === true;
      for (const [id, e] of Object.entries(saved.entries || {})) {
        if (validTs(id) && validTs(e.seenTs) && validTs(e.latestTs)) entries.set(id, {
          seenTs: e.seenTs, latestTs: e.latestTs, seenReplyCount: count(e.seenReplyCount), replyCount: count(e.replyCount),
          readOnKindle: e.readOnKindle === true || (saved.version === 1 && compareTs(e.seenTs, baseline) > 0),
        });
      }
    }
  } catch {}
  function save() {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify({ version: 2, channelId, baseline, initialized, entries: Object.fromEntries(entries) }), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file);
    } catch { onError(); }
  }
  return {
    get needsReadPosition() { return !initialized; },
    initializeReadPosition(lastRead) {
      if (initialized) return;
      if (validTs(lastRead)) {
        // Also repair the old bootstrap, which silently marked the whole first
        // history page read. Preserve explicit Kindle reads, including ones made
        // while conversations.info was temporarily unavailable.
        for (const [id, e] of entries) {
          if (!e.readOnKindle && compareTs(e.seenTs, lastRead) > 0) entries.set(id, {
            ...e, seenTs: lastRead, seenReplyCount: compareTs(id, lastRead) > 0 ? 0 : e.seenReplyCount,
          });
        }
        if (!baseline || compareTs(lastRead, baseline) < 0) baseline = lastRead;
      }
      // Bot tokens may not expose last_read. Their first history load remains
      // a quiet baseline; subsequent updates still become unread normally.
      initialized = true; save();
    },
    observe(messages) {
      const initial = baseline === null;
      if (initial) baseline = messages.length ? messages.map(messageActivity).sort(compareTs).at(-1) :
        Math.floor(now() / 1000) + '.' + String(Math.floor(now() % 1000) * 1000).padStart(6, '0');
      let dirty = initial;
      for (const m of messages) {
        const latestTs = messageActivity(m), replyCount = count(m.replyCount);
        const old = entries.get(m.id);
        const entry = { seenTs: old?.seenTs || (initial ? latestTs : baseline), readOnKindle: old?.readOnKindle || false,
          seenReplyCount: old?.seenReplyCount ?? (initial || compareTs(m.id, baseline) <= 0 ? replyCount : 0), latestTs, replyCount };
        if (!old || JSON.stringify(old) !== JSON.stringify(entry)) { entries.set(m.id, entry); dirty = true; }
      }
      if (dirty) save();
    },
    remove(ids) { let dirty = false; for (const id of ids) dirty = entries.delete(id) || dirty; if (dirty) save(); },
    acknowledge({ id, latestTs, replyCount }) {
      const old = entries.get(id);
      if (!old || !validTs(latestTs) || compareTs(latestTs, old.seenTs) < 0) return false;
      if (old.readOnKindle && old.seenTs === latestTs && old.seenReplyCount === count(replyCount)) return false;
      entries.set(id, { ...old, seenTs: latestTs, seenReplyCount: count(replyCount), readOnKindle: true }); save(); return true;
    },
    forMessage(message) {
      const e = entries.get(message.id);
      return { ...message, activityTs: messageActivity(message), unreadCount: e ? unread(e, message.id) : 0 };
    },
    get unreadCount() { return [...entries].reduce((sum, [id, e]) => sum + unread(e, id), 0); },
    get unreadIds() { return [...entries].filter(([id, e]) => unread(e, id)).sort((a, b) => compareTs(b[1].latestTs, a[1].latestTs)).map(([id]) => id); },
  };
}
