// Precompute the small set of battery states on the Mac. The K3 only selects
// a ready PNG, so its offline display needs no graphics runtime or network.
import { PNG } from 'pngjs';
import { toGray, encodeGray } from './gray.js';
import { page } from './screens/page.js';
import { renderBattery, BATTERY_CSS, BATTERY_WIDTH, BATTERY_HEIGHT, HEADER_HEIGHT, HEADER_PADDING } from './screens/battery.js';

export const BATTERY_STATES = [null, ...Array.from({ length: 101 }, (_, n) => n)]
  .flatMap((level) => [false, true].map((charging) => ({ level, charging })));

export function batteryAssetName({ level, charging }) {
  return `${level === null ? 'unknown' : level}-${charging ? 1 : 0}.png`;
}

export function renderBatteryAtlas() {
  return page(BATTERY_STATES.map(renderBattery).join(''), {
    width: BATTERY_WIDTH, height: BATTERY_HEIGHT * BATTERY_STATES.length, orientation: 'portrait',
    extraCss: BATTERY_CSS + '.battery{display:flex;margin:0;}',
  });
}

export function* offlineBatteryFrames(basePng, atlasPng) {
  const base = PNG.sync.read(basePng);
  const atlas = PNG.sync.read(atlasPng);
  if (atlas.width !== BATTERY_WIDTH || atlas.height !== BATTERY_HEIGHT * BATTERY_STATES.length) throw new Error('Invalid battery atlas');
  const pixels = toGray(base.data, base.width, base.height);
  const badges = toGray(atlas.data, atlas.width, atlas.height);
  const x = base.width - HEADER_PADDING - BATTERY_WIDTH;
  const y = (HEADER_HEIGHT - BATTERY_HEIGHT) / 2;
  if (x < 0 || base.height < HEADER_HEIGHT) throw new Error('Offline frame too small');
  for (let n = 0; n < BATTERY_STATES.length; n++) {
    for (let row = 0; row < BATTERY_HEIGHT; row++) {
      const from = (n * BATTERY_HEIGHT + row) * BATTERY_WIDTH;
      pixels.set(badges.subarray(from, from + BATTERY_WIDTH), (y + row) * base.width + x);
    }
    yield { name: batteryAssetName(BATTERY_STATES[n]), png: encodeGray(pixels, base.width, base.height) };
  }
}
