import { isIPv4 } from 'node:net';

export function isPrivateIPv4(host) {
  if (!isIPv4(host)) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function validateNetwork({ lanHost = '', deviceToken = '' }) {
  if (lanHost && !isPrivateIPv4(lanHost)) throw new Error('lanHost must be a private IPv4 address on this Mac');
  if ((lanHost || deviceToken) && !/^[a-f0-9]{64}$/.test(deviceToken)) {
    throw new Error('Wi-Fi requires a 64-character hex deviceToken; run scripts/kindle-wifi-setup.mjs');
  }
}
