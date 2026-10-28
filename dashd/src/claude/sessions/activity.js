// What a session is doing, the way the Claude app shows it: its task list, and
// a line for the tool call running right now. dashd addition, not in
// claude-thing.
//
// The task list is rebuilt from the session's own tool calls, so it survives a
// dashd restart (the transcript tail replays them):
//   • mcp__ccd_turn__update_plan (Claude app): {items} replaces the list;
//     {advance}, {done, start} move through it; wrap_up checks it all off.
//   • TodoWrite (terminal Claude Code): {todos} replaces the list.

const STATUSES = new Set(['pending', 'in_progress', 'completed']);

function item(content, status) {
  return { content: String(content || ''), status: STATUSES.has(status) ? status : 'pending' };
}

// The plan after one tool call, or undefined when the call is not about the
// plan. Step numbers in done/start are 1-based, as the tool takes them.
export function applyPlanCall(plan, name, input = {}) {
  if (name === 'TodoWrite') {
    return Array.isArray(input.todos) ? input.todos.map((t) => item(t.content, t.status)) : undefined;
  }
  if (name === 'mcp__ccd_turn__wrap_up') {
    return plan && plan.length ? plan.map((p) => ({ ...p, status: 'completed' })) : undefined;
  }
  if (name !== 'mcp__ccd_turn__update_plan') return undefined;

  if (Array.isArray(input.items)) return input.items.map((i) => item(i.content, i.status));
  const next = (plan || []).map((p) => ({ ...p }));
  if (input.advance) {
    const cur = next.findIndex((p) => p.status === 'in_progress');
    if (cur >= 0) next[cur].status = 'completed';
    const up = next.findIndex((p) => p.status === 'pending');
    if (up >= 0) next[up].status = 'in_progress';
  }
  for (const n of Array.isArray(input.done) ? input.done : []) {
    if (next[n - 1]) next[n - 1].status = 'completed';
  }
  if (Number.isInteger(input.start) && next[input.start - 1]) {
    // One step in progress at a time.
    for (const p of next) if (p.status === 'in_progress') p.status = 'pending';
    next[input.start - 1].status = 'in_progress';
  }
  return next;
}

function basename(p) {
  return String(p).split('/').filter(Boolean).pop() || String(p);
}

// One line for the running tool call: its own description when it has one
// (Bash, Agent and the like carry what they are for), else the tool and the
// thing it works on.
export function describeTool(name, input = {}) {
  const tool = String(name || '').replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '');
  if (input.description) return String(input.description);
  if (input.file_path) return tool + ' ' + basename(input.file_path);
  if (input.command) return tool + ': ' + String(input.command).split('\n')[0];
  if (input.pattern) return tool + ' ' + String(input.pattern);
  if (input.url) return tool + ' ' + String(input.url);
  if (input.query) return tool + ': ' + String(input.query);
  return tool;
}
