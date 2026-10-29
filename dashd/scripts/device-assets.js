// Build local fallback images with the same fonts/16-gray PNG pipeline.
import fs from 'node:fs';
import { createRenderer } from '../src/renderer.js';
import { renderOffline } from '../src/screens/offline.js';
import { CHROME_CHANNEL, CHROME_PATH } from '../src/config.js';
import { renderBatteryAtlas, offlineBatteryFrames, BATTERY_STATES } from '../src/offline-assets.js';
import { BATTERY_WIDTH, BATTERY_HEIGHT } from '../src/screens/battery.js';

const renderer = createRenderer({ channel: CHROME_CHANNEL, executablePath: CHROME_PATH });
try {
  const frame = await renderer.render(renderOffline(), { width: 600, height: 800 });
  fs.writeFileSync(new URL('../../kindle/dash/offline.png', import.meta.url), frame.png);
  const atlas = await renderer.render(renderBatteryAtlas(), { width: BATTERY_WIDTH, height: BATTERY_HEIGHT * BATTERY_STATES.length });
  const dir = new URL('../../kindle/dash/offline/', import.meta.url);
  fs.mkdirSync(dir, { recursive: true });
  for (const asset of offlineBatteryFrames(frame.png, atlas.png)) fs.writeFileSync(new URL(asset.name, dir), asset.png);
} finally { await renderer.close(); }
