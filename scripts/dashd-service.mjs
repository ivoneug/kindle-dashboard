#!/usr/bin/env node
// A per-user LaunchAgent: absolute paths work without an interactive shell/nvm.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const LABEL = 'local.kindle-dashboard.dashd';
const root = fileURLToPath(new URL('../', import.meta.url));
const xml = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function servicePlist({ node, root, log, env = {} }) {
  const environment = {
    PATH: [...new Set([path.dirname(node), ...(env.PATH || '').split(':'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].filter(Boolean))].join(':'),
    DASHD_CONFIG: env.DASHD_CONFIG || path.join(root, 'dashd/.config.json'),
  };
  for (const key of ['DASHD_AGENT', 'DASHD_CODEX_BIN', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']) {
    if (env[key]) environment[key] = env[key];
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(path.join(root, 'dashd/src/index.js'))}</string></array>
<key>WorkingDirectory</key><string>${xml(path.join(root, 'dashd'))}</string>
<key>EnvironmentVariables</key><dict>${Object.entries(environment).map(([k, v]) => `<key>${k}</key><string>${xml(v)}</string>`).join('')}</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${xml(log)}</string>
<key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`;
}

function main() {
  const action = process.argv[2] || 'status';
  if (!['install', 'uninstall', 'restart', 'status'].includes(action)) {
    throw new Error('Usage: node scripts/dashd-service.mjs install|uninstall|restart|status');
  }
  if (process.platform !== 'darwin') throw new Error('LaunchAgent requires macOS');
  const domain = `gui/${process.getuid()}`;
  const service = `${domain}/${LABEL}`;
  const plist = path.join(os.homedir(), 'Library/LaunchAgents', LABEL + '.plist');
  const log = path.join(os.homedir(), 'Library/Logs/kindle-dashboard/dashd.log');
  function launch(args, optional = false) {
    const r = spawnSync('/bin/launchctl', args, { encoding: 'utf8' });
    if (!optional && r.status !== 0) throw new Error(r.stderr?.trim() || r.error?.message || 'launchctl failed');
    return r;
  }
  if (action === 'status') {
    const r = launch(['print', service], true);
    if (r.status === 0) console.log(r.stdout.trim());
    else console.log('dashd LaunchAgent is not loaded');
    return;
  }
  if (action === 'uninstall') {
    launch(['bootout', service], true);
    fs.rmSync(plist, { force: true });
    console.log('Autostart removed. Config and logs kept.');
    return;
  }
  if (action === 'restart') {
    launch(['kickstart', '-k', service]);
    console.log('dashd restarted');
    return;
  }
  fs.accessSync(path.join(root, 'dashd/node_modules/playwright-core'));
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  const temp = plist + '.tmp';
  fs.writeFileSync(temp, servicePlist({ node: process.execPath, root, log, env: process.env }), { mode: 0o600 });
  const check = spawnSync('/usr/bin/plutil', ['-lint', temp], { encoding: 'utf8' });
  if (check.status !== 0) { fs.rmSync(temp, { force: true }); throw new Error(check.stdout || check.stderr); }
  launch(['bootout', service], true);
  fs.renameSync(temp, plist);
  launch(['enable', service]);
  launch(['bootstrap', domain, plist]);
  console.log(`dashd starts at login and restarts after exit.\n${plist}\nLog: ${log}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
