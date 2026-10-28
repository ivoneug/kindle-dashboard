// Versioned frames and the long-poll that hands them out.
//
// The Kindle's whole job is "is there a version other than the one on my
// screen? fetch it, show it". Versions only grow while dashd runs, but they
// restart at 1 with dashd, so a client is told about any version that differs
// from its own, not only a larger one.

export function createFrameStore({ fullEvery = 10, keep = 4 } = {}) {
  let version = 0;
  let lastFullVersion = 0;
  let partialsSinceFull = 0;
  const frames = new Map(); // version -> {png, full, ts, meta}
  const waiters = new Set();

  // full: this frame must be drawn with a full (flashing) refresh. Forced for
  // the first frame and after fullEvery partial ones, to clear ghosting.
  function publish(png, { full = false, meta = {} } = {}) {
    version += 1;
    if (version === 1 || partialsSinceFull >= fullEvery) full = true;
    if (full) { lastFullVersion = version; partialsSinceFull = 0; } else partialsSinceFull += 1;
    frames.set(version, { png, full, ts: Date.now(), meta });
    for (const v of frames.keys()) if (v <= version - keep) frames.delete(v);
    for (const w of waiters) w();
    return version;
  }

  // Whether a client showing `since` must refresh fully to reach the current
  // frame: a full frame anywhere in between still owes its flash, and a client
  // from before a restart (or with nothing on screen) has unknown ghosts.
  function needsFull(since) {
    return !(since > 0 && since <= version && lastFullVersion <= since);
  }

  function status(since) {
    return { version, full: needsFull(since) };
  }

  // Resolves as soon as the current version differs from `since`, or with the
  // unchanged one after timeoutMs. abort() drops the wait (client went away).
  function waitForChange(since, timeoutMs) {
    let done;
    const promise = new Promise((resolve) => {
      if (version > 0 && version !== since) return resolve(status(since));
      const finish = () => {
        clearTimeout(timer);
        waiters.delete(finish);
        resolve(status(since));
      };
      const timer = setTimeout(finish, timeoutMs);
      waiters.add(finish);
      done = () => { clearTimeout(timer); waiters.delete(finish); };
    });
    return { promise, abort: () => done && done() };
  }

  return {
    publish,
    waitForChange,
    status,
    get: (v) => frames.get(v) || null,
    current: () => (version ? { version, ...frames.get(version) } : null),
    get version() { return version; },
  };
}
