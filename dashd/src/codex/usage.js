// Codex reports percent consumed, not percent remaining. Support the RPC's
// camelCase and rollout token_count's snake_case without guessing missing data.
export function normalizeUsage(result, now = Date.now()) {
  const buckets = result?.rateLimitsByLimitId || (result?.rateLimits ? { codex: result.rateLimits } : {});
  const limits = [];
  for (const [key, bucket] of Object.entries(buckets)) {
    if (!bucket) continue;
    for (const slot of ['primary', 'secondary']) {
      const w = bucket[slot];
      const used = w?.usedPercent ?? w?.used_percent;
      if (typeof used !== 'number' || !Number.isFinite(used)) continue;
      const mins = w.windowDurationMins ?? w.window_minutes;
      const window = mins === 10080 ? 'WEEKLY' : mins === 300 ? '5 HOURS' : mins ? `${mins} MIN` : slot.toUpperCase();
      const reset = w.resetsAt ?? w.resets_at;
      limits.push({ key, windowMinutes: mins ?? null, label: `${bucket.limitName || bucket.limit_name || key} · ${window}`,
        used: Math.max(0, Math.min(1, used / 100)),
        detail: reset ? 'resets ' + new Date(reset * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '' });
    }
  }
  const resets = result?.rateLimitResetCredits;
  const resetCredits = resets ? {
    availableCount: resets.availableCount,
    // Details can be unavailable or capped independently of the total count.
    credits: Array.isArray(resets.credits) ? resets.credits.filter((c) => c.status === 'available').map((c) => ({
      id: c.id, title: c.title || 'Usage limit reset', description: c.description || '',
      expiresTs: c.expiresAt == null ? null : c.expiresAt * 1000,
    })) : [],
  } : null;
  return { provider: 'codex', limits, resetCredits, updatedTs: now, updatedLabel: 'Codex · updated ' +
    new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    stale: false, ...(limits.length ? {} : { error: 'Codex usage is not available for this account' }) };
}
