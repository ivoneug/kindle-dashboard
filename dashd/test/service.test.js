import test from 'node:test';
import assert from 'node:assert/strict';
import { servicePlist } from '../../scripts/dashd-service.mjs';

test('LaunchAgent uses absolute nvm paths, escapes XML and keeps the device secret out', () => {
  const plist = servicePlist({ node: '/Users/me/.nvm/node/bin/node', root: '/Users/me/Kindle & Code', log: '/Users/me/dash.log',
    env: { PATH: '/usr/bin', DASHD_CONFIG: '/Users/me/private/config.json', DASHD_DEVICE_TOKEN: 'secret' } });
  assert.ok(plist.includes('<string>/Users/me/.nvm/node/bin/node</string>'));
  assert.ok(plist.includes('/Users/me/Kindle &amp; Code/dashd/src/index.js'));
  assert.ok(plist.includes('/Users/me/private/config.json'));
  assert.ok(plist.includes('<key>KeepAlive</key><true/>'));
  assert.ok(!plist.includes('secret'));
});
