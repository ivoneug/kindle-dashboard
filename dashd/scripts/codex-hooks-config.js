// Pure hook config merge, shared by the installer and its checks.
const quote = (s) => "'" + String(s).replaceAll("'", "'\\''") + "'";
const ours = (hook) => hook.type === 'command' && hook.command?.includes('codex-hook.js') && hook.command.includes('--kindle-dashboard');
export function mergeCodexHooks(config, { node, script, port, remove = false }) {
  const next = structuredClone(config);
  next.hooks ||= {};
  // Remove individual handlers, preserving other handlers in the same group.
  for (const [event, groups] of Object.entries(next.hooks)) {
    next.hooks[event] = groups.map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !ours(h)) })).filter((g) => g.hooks.length);
    if (!next.hooks[event].length) delete next.hooks[event];
  }
  if (!remove) {
    const command = [node, script, '--kindle-dashboard', '--port', String(port)].map(quote).join(' ');
    for (const event of ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Interrupt', 'PermissionRequest']) {
      (next.hooks[event] ||= []).push({ hooks: [{ type: 'command', command,
        timeout: event === 'PermissionRequest' ? 600 : 3 }] });
    }
  }
  return next;
}
