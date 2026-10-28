// Codex has two title sources beyond thread.name: the JSONL title index for
// native chats, and the import manifest retaining a migrated Claude chat's
// real title. thread.preview is the first prompt, not a title.
import fs from 'node:fs';
import path from 'node:path';
import { CODEX_HOME } from './config.js';

function title(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text !== 'Imported session' && !text.startsWith('<') && !text.startsWith('[external unsupported block:') ? text : null;
}

export function sessionName(row, titles = new Map()) {
  return title(row.name) || title(titles.get(row.id)) || 'Untitled session';
}

// Cache by file metadata; title changes appear on the next dashboard poll.
// Partial writes keep the preceding valid snapshot until the writer finishes.
export function createTitleIndex({ home = CODEX_HOME } = {}) {
  const cache = new Map();
  function read(name, parse) {
    const file = path.join(home, name);
    let stat;
    try { stat = fs.statSync(file); } catch { cache.delete(name); return new Map(); }
    const key = `${stat.ino}:${stat.mtimeMs}:${stat.size}`;
    if (cache.get(name)?.key === key) return cache.get(name).titles;
    try {
      const titles = parse(fs.readFileSync(file, 'utf8'));
      cache.set(name, { key, titles });
      return titles;
    } catch { return cache.get(name)?.titles || new Map(); }
  }

  return {
    read() {
      const imported = read('external_agent_session_imports.json', (text) => {
        const parsed = JSON.parse(text);
        return new Map((parsed.records || []).filter((r) => r.imported_thread_id && title(r.title))
          .map((r) => [r.imported_thread_id, title(r.title)]));
      });
      const native = read('session_index.jsonl', (text) => {
        const names = new Map();
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          const r = JSON.parse(line);
          if (r.id && title(r.thread_name)) names.set(r.id, title(r.thread_name));
        }
        return names;
      });
      return new Map([...imported, ...native]);
    },
  };
}
