#!/usr/bin/env node
// Prepare matching local-only settings on Mac and Kindle. Deploy separately
// so the daemon can be restarted with authentication before the client moves.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { isPrivateIPv4, validateNetwork } from '../dashd/src/network.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
function argument(name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing value for ' + name);
  return args[i + 1];
}
if (args.includes('--help')) {
  console.log('node scripts/kindle-wifi-setup.mjs [--host MAC_LAN_IP | --interface en0] [--usb]');
  process.exit(0);
}
const configPath = process.env.DASHD_CONFIG || path.join(root, 'dashd/.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
const iface = argument('--interface', 'en0');
const address = (os.networkInterfaces()[iface] || []).find((a) => !a.internal && isPrivateIPv4(a.address))?.address;
const usb = args.includes('--usb');
const lanHost = argument('--host', process.env.DASHD_LAN_HOST || (usb ? (config.lanHost || '') : address));
if (!usb && !lanHost) throw new Error('No private IPv4 address on ' + iface + '; provide --host MAC_LAN_IP');
if (lanHost) config.lanHost = lanHost;
config.deviceToken = process.env.DASHD_DEVICE_TOKEN || config.deviceToken || randomBytes(32).toString('hex');
validateNetwork(config);
const port = Number(process.env.DASHD_PORT || config.port || 8765);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid dashboard port');
config.port = port;
const host = usb ? (process.env.DASHD_USB_HOST || config.usbHost || '192.168.2.1') : lanHost;
if (!isPrivateIPv4(host)) throw new Error('Device host must be a private IPv4 address');

function writeLocal(file, content) {
  const temp = file + '.tmp-' + process.pid;
  fs.writeFileSync(temp, content, { mode: 0o600 });
  fs.renameSync(temp, file);
}
writeLocal(configPath, JSON.stringify(config, null, 2) + '\n');
writeLocal(path.join(root, 'kindle/dash/network.local.sh'),
  '# Generated local settings; contains the dashboard shared secret. Do not commit.\n' +
  `DASH_HOST=${host}\nDASH_PORT=${port}\nDASH_WIFI=${usb ? 0 : 1}\nDASH_TOKEN=${config.deviceToken}\n`);
console.log(`Prepared ${usb ? 'USB' : 'Wi-Fi'} → http://${host}:${port} (shared token saved, not printed).`);
console.log('Restart dashd, then ./scripts/kindle-deploy.sh and restart /mnt/us/dash/start.sh.');
