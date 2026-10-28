// The default hook command follows the same backend as npm start.
import { AGENT } from '../src/config.js';
if (AGENT === 'codex') await import('./install-codex-hooks.js');
else if (process.argv.includes('--remove')) await import('./uninstall-hooks.js');
else await import('./install-hooks.js');
