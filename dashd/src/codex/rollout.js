// Codex's local JSONL history. Version-dependent, so tolerate unknown records
// and keep this parser separate from the official hook/RPC transports.
import fs from 'node:fs';
import { describeTool } from '../claude/sessions/activity.js';

const LAST_MESSAGE_CAP = 4000;
const safeJson = (s) => { try { return JSON.parse(s); } catch { return null; } };
const textOf = (content) => (Array.isArray(content) ? content : []).filter((c) => ['output_text', 'text', 'input_text'].includes(c.type)).map((c) => c.text || '').join('\n');
const stamp = (o) => Date.parse(o.timestamp) || 0;

// Scheduled chats can return a service envelope instead of plain Markdown.
// Only unwrap a complete heartbeat: IDs and notification decisions are not
// prose. Code examples and ordinary HTML still go to the escaped renderer.
const HEARTBEAT_META = String.raw`(?:<automation_id>[^<]*</automation_id>|<decision>[^<]*</decision>)\s*`;
const HEARTBEAT_MESSAGE = new RegExp(String.raw`^\s*<heartbeat>\s*(?:${HEARTBEAT_META})*<message>([\s\S]*?)</message>\s*(?:${HEARTBEAT_META})*</heartbeat>\s*$`);

function messageText(value) {
  const text = String(value);
  const heartbeat = HEARTBEAT_MESSAGE.exec(text);
  return (heartbeat ? heartbeat[1].trim() : text).slice(0, LAST_MESSAGE_CAP);
}

export function questionFrom(input, id, createdTs) {
  if (!Array.isArray(input?.questions)) return null;
  return { kind: 'question', id, createdTs, questions: input.questions.map((q) => ({
    header: String(q.header || ''), question: String(q.question || ''),
    options: (q.options || []).map((v) => ({ label: String(v.label || ''), description: String(v.description || '') })),
  })) };
}

export function applyRecord(s, o, { onUsage = () => {} } = {}) {
  const p = o.payload || {};
  const ts = stamp(o);
  if (ts) s.lastActivityTs = Math.max(s.lastActivityTs || 0, ts);
  if (o.type === 'session_meta') {
    s.cwd = p.cwd || s.cwd;
    s.startedTs = Date.parse(p.timestamp) || s.startedTs;
    s.internal = p.thread_source === 'guardian_review' || (typeof p.source === 'object' && !!p.source?.subagent);
  } else if (o.type === 'turn_context') {
    s.native = true;
    s.model = p.model || s.model;
    s.effort = p.effort || s.effort;
    s.permissionMode = p.approval_policy || s.permissionMode;
  } else if (o.type === 'event_msg') {
    switch (p.type) {
      case 'task_started':
        s.thinking = true; s.stoppedTs = null; s.currentTool = null; s.activity = null;
        s.question = null;
        s.contextWindow = p.model_context_window || s.contextWindow;
        break;
      case 'task_complete':
      case 'turn_aborted':
        s.thinking = false; s.stoppedTs = ts; s.currentTool = null; s.activity = null; s.waitingForInput = false;
        s.question = null;
        if (p.last_agent_message) s.lastMessage = messageText(p.last_agent_message);
        break;
      case 'agent_message':
        if (p.message) s.lastMessage = messageText(p.message);
        break;
      case 'user_message':
        if (p.message) s.lastPrompt = String(p.message).replace(/\s+/g, ' ').slice(0, 120);
        break;
      case 'token_count': {
        const total = p.info?.total_token_usage;
        const last = p.info?.last_token_usage;
        if (total) { s.tokensIn = total.input_tokens || 0; s.tokensOut = total.output_tokens || 0; s.cacheRead = total.cached_input_tokens || 0; }
        s.contextWindow = p.info?.model_context_window || s.contextWindow;
        if (last) s.contextTokens = last.total_tokens ?? ((last.input_tokens || 0) + (last.output_tokens || 0));
        if (p.rate_limits) onUsage(p.rate_limits, ts);
        break;
      }
    }
  } else if (o.type === 'response_item') {
    if (p.type === 'message' && p.role === 'assistant') {
      const text = textOf(p.content);
      if (text) s.lastMessage = messageText(text);
    }
    if (['function_call', 'custom_tool_call'].includes(p.type)) {
      const name = p.name || 'tool';
      const input = typeof p.arguments === 'string' ? safeJson(p.arguments) : p.arguments;
      const args = input || {};
      if (name === 'update_plan' || name.endsWith('__update_plan')) {
        const plan = args.plan || args.items;
        if (Array.isArray(plan)) s.plan = plan.map((x) => ({ content: String(x.step || x.content || ''), status: ['pending', 'in_progress', 'completed'].includes(x.status) ? x.status : 'pending' }));
      }
      if (/(^|[._])request_user_input$/.test(name)) {
        s.waitingForInput = true;
        s.question = questionFrom(args, p.call_id, ts);
      }
      s.currentTool = name; s.activity = describeTool(name, { ...args, command: args.cmd || args.command }); s.activityTs = ts;
      s.toolCallId = p.call_id;
    }
    if (['function_call_output', 'custom_tool_call_output'].includes(p.type) && p.call_id === s.toolCallId) {
      s.currentTool = null; s.activity = null; s.waitingForInput = false;
      s.question = null;
    }
  }
  return s;
}

// Consume only appended bytes; keep an incomplete final JSON line for next
// time. Initial replay is bounded to the last 4 MB, keeping startup responsive
// on large imported chats. Metadata/model also come from thread/list.
export function createRolloutReader({ maxInitialBytes = 4 * 1024 * 1024, maxLineBytes = 8 * 1024 * 1024 } = {}) {
  let offset = 0, inode = null, remainder = '', dropping = false;
  return {
    read(file, onRecord) {
      const stat = fs.statSync(file);
      if (inode !== stat.ino || stat.size < offset) {
        inode = stat.ino; offset = Math.max(0, stat.size - maxInitialBytes); remainder = ''; dropping = offset > 0;
      }
      const fd = fs.openSync(file, 'r');
      try {
        const buffer = Buffer.alloc(64 * 1024);
        const end = stat.size;
        while (offset < end) {
          const n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, end - offset), offset);
          if (!n) break;
          offset += n;
          // Buffer across chunks to avoid splitting a Cyrillic character.
          remainder += buffer.subarray(0, n).toString('latin1');
          let at;
          while ((at = remainder.indexOf('\n')) >= 0) {
            const line = remainder.slice(0, at); remainder = remainder.slice(at + 1);
            if (dropping) { dropping = false; continue; }
            const o = safeJson(Buffer.from(line, 'latin1').toString('utf8'));
            if (o) onRecord(o);
          }
          if (remainder.length > maxLineBytes) { remainder = ''; dropping = true; }
        }
      } finally { fs.closeSync(fd); }
    },
  };
}
