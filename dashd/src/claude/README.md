# Claude Code side of dashd

Imported from **claude-thing**'s Mac daemon: https://github.com/rithkott/claude-thing, `daemon/src` at commit `920192b` (author's fork: https://github.com/ivoneug/claude-thing). GPL-3.0, see [LICENSE](../../../LICENSE).

It covers session discovery (hooks, `claude agents --json` polling, transcript tails), the permission bridge, the question queue, usage via `claude -p "/usage"`, and raising a session's terminal window. Message shapes are described in [docs/claude-protocol.md](../../../docs/claude-protocol.md). That document describes a WebSocket protocol dashd does not use, but the `SessionSummary`, `SessionDetail`, `Ask` and `Usage` shapes in it are exactly what these modules produce.

## What changed on import

- **Not imported:** `hub.js` (WebSocket hub), `http-server.js`, `index.js`, the Bluetooth chunk limits and the smoke and hub tests. dashd calls the modules in-process ([index.js](index.js)) and accepts hooks through its own HTTP server, on loopback only.
- **`config.js`:** transport settings removed. State lives in `dashd/.state`.
- **`log.js`:** re-exports dashd's logger.
- **`permission-bridge.js`:**
  - `shouldHold()`: with no Kindle attached, a request goes to the terminal at once instead of blocking the session for ten minutes;
  - `releaseAll()`: everything held goes back to the terminal when the Kindle drops off;
  - `"ask"` is a valid decision (the Back key).
- **`focus.js`:** a session inside the Claude desktop app (no tty) raises the app with `open -a Claude` instead of failing with "session has no tty".
- **Last message:** kept up to `LAST_MESSAGE_CAP` (4000) characters instead of 200, and taken from assistant records only (user-side records carry text blocks too), for the detail screen.
- **`source-hooks.js`:** machine-made prompts (a single tag-wrapped block such as `<task-notification>`) do not become `lastMessage` or `lastPrompt`.
- **Activity** ([sessions/activity.js](sessions/activity.js)), new: each session's task list is rebuilt from its plan tool calls in the transcript (`update_plan` and `wrap_up` from the Claude app, `TodoWrite` from the terminal). The running tool call's description comes from `PreToolUse`. Both are in `SessionDetail` as `plan`, `activity` and `activityTs`.
- **Hook scripts** (`dashd/scripts/install-hooks.js`, `uninstall-hooks.js`) point at dashd's port and refuse to install next to claude-thing's own hooks.

Tests are in `dashd/test/claude/`, unchanged except for import paths. The Kindle changes are covered by `dashd/test/kindle-hold.test.js`.

When pulling fixes from upstream, diff its `daemon/src` against `920192b` and apply the result here.
