// PermissionRequest precedes Codex's normal reviewer. Only intercept an
// explicitly human-reviewed turn; auto-review and unknown contexts must keep
// their native approval flow. Global config cannot identify a chat's reviewer.
import fs from 'node:fs';
import path from 'node:path';
import { CODEX_HOME } from './config.js';

const MAX_HEADER = 512 * 1024;
const MAX_TAIL = 4 * 1024 * 1024;
const json = (line) => { try { return JSON.parse(line); } catch { return null; } };

export function readPermissionContext(payload, { home = CODEX_HOME } = {}) {
  if (!payload.session_id || !payload.turn_id || typeof payload.transcript_path !== 'string') return null;
  let fd;
  try {
    const root = fs.realpathSync(home);
    const file = fs.realpathSync(payload.transcript_path);
    if (!['sessions', 'archived_sessions'].some((name) => file.startsWith(path.join(root, name) + path.sep)) ||
        !file.endsWith('.jsonl')) return null;
    fd = fs.openSync(file, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || !stat.size) return null;
    const head = Buffer.alloc(Math.min(stat.size, MAX_HEADER));
    const headSize = fs.readSync(fd, head, 0, head.length, 0);
    const firstEnd = head.subarray(0, headSize).indexOf(10);
    if (firstEnd < 0) return null;
    const meta = json(head.subarray(0, firstEnd).toString('utf8'));
    if (meta?.type !== 'session_meta' || meta.payload?.id !== payload.session_id) return null;

    const start = Math.max(0, stat.size - MAX_TAIL);
    const tail = Buffer.alloc(stat.size - start);
    const size = fs.readSync(fd, tail, 0, tail.length, start);
    // Do not reuse the previous reviewer during a partial context write.
    if (size !== tail.length || tail[size - 1] !== 10) return null;
    const lines = tail.toString('utf8').split('\n');
    if (start) lines.shift();
    let updatedSettings;
    for (let i = lines.length - 1; i >= 0; i--) {
      const item = json(lines[i]);
      // The desktop permissions control can change mid-turn. Its applied
      // settings event is newer than turn_context and wins for that turn.
      if (item?.type === 'event_msg' && item.payload?.type === 'thread_settings_applied' &&
          updatedSettings === undefined) {
        if (item.payload.thread_id !== payload.session_id) return null;
        updatedSettings = item.payload.thread_settings || {};
      }
      if (item?.type !== 'turn_context') continue;
      const context = item.payload;
      // Never use a previous turn (or another chat's file) for this request.
      if (context?.turn_id !== payload.turn_id) return null;
      const reviewer = (updatedSettings || context).approvals_reviewer;
      return ['user', 'auto_review'].includes(reviewer)
        ? { reviewer, turnId: context.turn_id } : null;
    }
  } catch {
    // Missing, unreadable or unfamiliar history leaves Codex in charge.
  } finally { if (fd !== undefined) fs.closeSync(fd); }
  return null;
}
