import { page, legend } from './page.js';
import { renderBattery, BATTERY_CSS } from './battery.js';

// Pre-rendered and stored on the Kindle: available while the Mac is asleep.
export function renderOffline({ width = 600, height = 800, battery } = {}) {
  return page(`<div class="screen offline"><header>DASHBOARD ${renderBattery(battery)}</header><main>
    <div class="symbol">!</div><h1>NO CONNECTION</h1>
    <p>Wi-Fi unavailable<br>or Mac asleep.</p>
    <strong>Reconnecting automatically</strong>
    <p class="hint">The dashboard returns when<br>the Mac is reachable again.</p>
    </main>${legend([['Home', 'return to Kindle']])}</div>`, {
    width, height, orientation: 'portrait', extraCss: `
    ${BATTERY_CSS}
    .offline header{height:70px;padding:0 24px;display:flex;align-items:center;font-size:18px;letter-spacing:.18em;border-bottom:var(--rule)}
    .offline main{flex:1;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
    .offline .symbol{border:5px solid var(--ink);width:88px;height:88px;border-radius:50%;font:700 60px/80px var(--mono)}
    .offline h1{font-size:38px;letter-spacing:.04em;margin:28px 0 8px}
    .offline p{font-size:26px;line-height:1.4;margin:16px 0 32px}
    .offline strong{font-size:23px;border-top:var(--rule);padding-top:28px}
    .offline .hint{font-size:20px;color:var(--muted);margin-bottom:0}
  ` });
}
