// Build local fallback images with the same fonts/16-gray PNG pipeline.
import fs from 'node:fs';
import { createRenderer } from '../src/renderer.js';
import { renderOffline } from '../src/screens/offline.js';
import { CHROME_CHANNEL, CHROME_PATH } from '../src/config.js';

const renderer = createRenderer({ channel: CHROME_CHANNEL, executablePath: CHROME_PATH });
try {
  const frame = await renderer.render(renderOffline(), { width: 600, height: 800 });
  fs.writeFileSync(new URL('../../kindle/dash/offline.png', import.meta.url), frame.png);
} finally { await renderer.close(); }
