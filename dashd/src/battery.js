// Shell telemetry is intentionally small and strict. Unknown readings are
// displayed as --%, never confused with an empty or fully charged battery.
export function parseBattery(level, charging) {
  if (!(level === 'unknown' || /^(0|[1-9]\d{0,2})$/.test(level || ''))) return null;
  if (!['0', '1', 'unknown'].includes(charging)) return null;
  if (level !== 'unknown' && Number(level) > 100) return null;
  return { level: level === 'unknown' ? null : Number(level),
    charging: charging === 'unknown' ? null : charging === '1' };
}
