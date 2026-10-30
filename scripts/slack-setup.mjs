#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createSlackApi } from '../dashd/src/slack/api.js';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function configureSlack({ token, channelId, configFile = path.join(root, 'dashd/.config.json'),
  tokenFile = path.join(root, 'dashd/.slack-token'), api = createSlackApi({ token }) }) {
  if (!/^xox[pb]-[A-Za-z0-9-]+$/.test(token || '')) throw new Error('Use the OAuth token from your Slack app (xoxp- for the supplied manifest).');
  if (!/^[CG][A-Z0-9]+$/.test(channelId || '')) throw new Error('Pass --channel with the Slack channel ID.');
  await api('auth.test');
  const { channel } = await api('conversations.info', { channel: channelId });
  const history = await api('conversations.history', { channel: channelId, limit: 1 });
  const parent = history.messages?.find((m) => !m.thread_ts || m.thread_ts === m.ts);
  if (parent) await api('conversations.replies', { channel: channelId, ts: parent.ts, limit: 1 });
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error('Cannot read existing dashboard config.'); }
  const write = (file, body) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', body, { mode: 0o600 }); fs.chmodSync(file + '.tmp', 0o600); fs.renameSync(file + '.tmp', file);
  };
  write(tokenFile, token + '\n');
  write(configFile, JSON.stringify({ ...config, slackChannelId: channelId, slackChannelName: channel.name, slackTokenFile: tokenFile }, null, 2) + '\n');
  return { channelName: channel.name };
}

async function hiddenToken() {
  if (!process.stdin.isTTY) {
    let text = ''; for await (const chunk of process.stdin) text += chunk;
    return text.trim();
  }
  process.stdout.write('Paste Slack User OAuth Token (input hidden), then Enter: ');
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (error) => {
      process.stdin.off('data', read); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n');
      if (error) reject(error); else resolve(value.trim());
    };
    const read = (chunk) => {
      for (const c of chunk) {
        if (c === '\u0003' || c === '\u0004') return done(new Error('Cancelled.'));
        if (c === '\r' || c === '\n') return done();
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else if (c >= ' ') value += c;
      }
    };
    process.stdin.on('data', read);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const i = process.argv.indexOf('--channel'), channelId = i >= 0 ? process.argv[i + 1] : '';
    if (!/^[CG][A-Z0-9]+$/.test(channelId || '')) throw new Error('Usage: node scripts/slack-setup.mjs --channel C0123456789');
    const token = process.env.DASHD_SLACK_TOKEN || await hiddenToken();
    const result = await configureSlack({ token, channelId, configFile: process.env.DASHD_CONFIG || undefined });
    console.log('Connected #' + result.channelName + '. Token saved locally with mode 0600.');
    if (process.argv.includes('--restart')) {
      const restart = spawnSync(process.execPath, [path.join(root, 'scripts/dashd-service.mjs'), 'restart'], { stdio: 'inherit' });
      if (restart.status !== 0) throw new Error('Settings saved; restart dashd with node scripts/dashd-service.mjs restart.');
    } else console.log('Run: node scripts/dashd-service.mjs restart');
  } catch (e) { console.error(e.code ? 'Slack setup failed: ' + e.code : e.message); process.exitCode = 1; }
}
