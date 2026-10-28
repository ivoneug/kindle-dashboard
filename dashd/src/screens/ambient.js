import { page, esc, fmtClock, legend } from './page.js';
import { mascot } from './mascots.js';

export function renderAmbient({ orientation, provider = 'codex', sessions = 0, now = Date.now() }, { width, height }) {
  const date = new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const body = `<div class="screen ambient">
    <header><span class="quiet-dot"></span> ALL QUIET</header>
    <main>${mascot(provider, 'sleeping-idle', { size: 96, muted: true })}
      <div class="time">${fmtClock(now)}</div><div class="date">${esc(date)}</div>
      <div class="summary">${sessions} SESSION${sessions === 1 ? '' : 'S'} · NOTHING WAITING</div>
    </main>${legend([['ANY KEY', 'wake']], 'Home · Kindle')}</div>`;
  return page(body, { width, height, orientation, extraCss: `
    .ambient header{height:70px;padding:24px;display:flex;align-items:center;gap:12px;font-size:18px;letter-spacing:.18em}
    .quiet-dot{width:14px;height:14px;border:3px solid var(--ink);border-radius:50%}
    .ambient main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-bottom:32px}
    .ambient .time{font:500 ${width < height ? 148 : 156}px/1.2 var(--mono);letter-spacing:-.08em;margin:22px 0 12px;padding-right:.08em}
    .ambient .date{font-size:26px;text-transform:uppercase;letter-spacing:.05em}
    .ambient .summary{font:16px var(--mono);color:var(--muted);margin-top:40px}
    .ambient.landscape main{padding-bottom:14px}.ambient.landscape .sprite{width:64px;height:64px}
    .ambient.landscape .time{margin:0}.ambient.landscape .summary{margin-top:22px}
  ` });
}
