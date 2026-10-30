export const BATTERY_WIDTH = 128;
export const BATTERY_HEIGHT = 40;
export const HEADER_HEIGHT = 70;
export const HEADER_PADDING = 24;

export const BATTERY_CSS = `
  .battery{display:inline-flex;flex:none;align-items:center;justify-content:flex-end;gap:10px;
    width:${BATTERY_WIDTH}px;height:${BATTERY_HEIGHT}px;margin-left:auto;
    font:500 22px/1 var(--mono);letter-spacing:0;white-space:nowrap;color:var(--ink)}
  .battery svg{flex:none}.battery .battery-percent{min-width:53px;text-align:right}
  .battery.compact{width:auto;margin:0;gap:4px}.battery.compact .battery-percent{min-width:0}
`;

export function renderBattery(battery, { compact = false } = {}) {
  const level = Number.isInteger(battery?.level) && battery.level >= 0 && battery.level <= 100 ? battery.level : null;
  const charging = battery?.charging === true;
  const icon = charging
    ? '<svg width="22" height="28" viewBox="0 0 22 28" aria-hidden="true"><path d="M12 1 2 16h8l-1 11 11-16h-8z" fill="currentColor"/></svg>'
    : '<svg width="36" height="24" viewBox="0 0 36 24" aria-hidden="true">' +
      '<rect x="1.5" y="4" width="29" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="3"/>' +
      '<path d="M32 9h3v7h-3z" fill="currentColor"/>' +
      (level !== null ? `<rect x="5" y="7.5" width="${(22 * level / 100).toFixed(2)}" height="10" fill="currentColor"/>` : '') + '</svg>';
  const text = (level === null ? '--' : level) + '%';
  return `<span class="battery${charging ? ' charging' : ''}${compact ? ' compact' : ''}" aria-label="${charging ? 'Charging' : 'Battery'} ${text}">${icon}<span class="battery-percent">${text}</span></span>`;
}
