const METHODS = new Set(['auth.test', 'conversations.info', 'conversations.history', 'conversations.replies', 'users.info']);

export class SlackError extends Error {
  constructor(code, retryMs = 0) { super(code); this.code = code; this.retryMs = retryMs; }
}

// Only read methods are available. Credentials never enter a URL or an error.
export function createSlackApi({ token, fetchImpl = fetch, now = Date.now, timeoutMs = 15_000 } = {}) {
  const blocked = new Map();
  return async function request(method, params = {}) {
    if (!METHODS.has(method)) throw new SlackError('unsupported_method');
    const remaining = (blocked.get(method) || 0) - now();
    if (remaining > 0) throw new SlackError('ratelimited', remaining);
    const url = new URL('https://slack.com/api/' + method);
    for (const [key, value] of Object.entries(params)) if (value != null && value !== '') url.searchParams.set(key, String(value));
    let response;
    try {
      response = await fetchImpl(url, { headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    } catch { throw new SlackError('connection_failed'); }
    if (response.status === 429) {
      const delay = Math.max(1000, (Number(response.headers.get('retry-after')) || 60) * 1000);
      blocked.set(method, now() + delay); throw new SlackError('ratelimited', delay);
    }
    if (!response.ok) throw new SlackError('http_' + response.status);
    let data;
    try { data = await response.json(); } catch { throw new SlackError('invalid_response'); }
    if (!data || data.ok !== true) {
      const code = /^[a-z_]{1,60}$/.test(data?.error) ? data.error : 'invalid_response';
      throw new SlackError(code);
    }
    return data;
  };
}
