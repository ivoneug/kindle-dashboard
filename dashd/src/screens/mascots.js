// Keep Clawd's state-specific sprites for Claude. Codex uses its own glyph,
// copied from Codex.app's codex_new SVG with fills changed to currentColor.
import fs from 'node:fs';
import { esc } from './page.js';
import { sprite } from './sprites.js';

let codex = null;

export function mascot(provider, name, options = {}) {
  if (provider !== 'codex') return sprite(name, options);
  if (!codex) codex = fs.readFileSync(new URL('../sprites/codex.svg', import.meta.url), 'utf8');
  const { size = 64, inverted = false, muted = false, className = 'sprite' } = options;
  const color = inverted ? '#ffffff' : muted ? '#666666' : '#000000';
  return codex.replace('<svg ', '<svg class="' + esc(className) + '" color="' + color + '" aria-hidden="true" ')
    .replace('width="24"', 'width="' + size + '"')
    .replace('height="24"', 'height="' + size + '"');
}
