# Kindle Dashboard

**English** | [Русский](README.ru.md)

An e-ink dashboard for Codex and Claude Code on the Kindle Keyboard (K3). See the [design specification and research (Russian)](kindle-dashboard.md).

The Kindle runs as a thin client: it fetches a ready-to-display PNG from the Mac, draws it with `eips`, and sends raw key presses back. All application logic, rendering, and key mappings live in `dashd` on the Mac. The selected backend runs in the same process: Codex by default, or Claude Code. The shared store, approval bridge, and visual design are based on [claude-thing](https://github.com/rithkott/claude-thing).

```text
dashd/                Mac: rendering (headless Chrome → 16 shades of gray) + Kindle HTTP API
  src/claude/         claude-thing daemon core (sessions, approvals, usage); see its README
  src/codex/          Codex: app-server, chat history, limits, and command hooks
  src/screens/        Sessions, session details, Queue, Usage
  src/theme/          e-ink theme; fonts.css is extracted from claude-thing (npm run fonts)
  src/keys.js         raw key code → action
  scripts/            Claude Code hook installation and asset generators
kindle/dash/          Kindle: copied to /mnt/us/dash
  config.sh           dashd address, eips flags, exit key
  client.sh           long-poll /version → /frame.png → eips
  keys.sh             waitforkey → /key
  start.sh / stop.sh  take over the screen / restore the stock UI
  discovery.sh        M0: collect device information and key codes
scripts/kindle-deploy.sh       copy kindle/dash to the Kindle (USB storage or SSH)
scripts/kindle-wifi-setup.mjs  generate paired Mac/Kindle settings for Wi-Fi
```

## dashd

```bash
cd dashd && npm install
npm start
```

Google Chrome must be installed: `playwright-core` uses it for headless rendering without downloading a separate browser. By default, the daemon listens on `127.0.0.1:8765` and the Mac's USB network address (`192.168.2.1`). Wi-Fi adds a specific address on the home network and requires a device key (see below). Binding to unavailable addresses is retried every 5 seconds; the daemon does not listen on `0.0.0.0`.

The [local preview](http://127.0.0.1:8765/) shows the current frame exactly as the Kindle receives it, with an orientation switch and simulated key presses. It is available only over loopback.

Settings are read from `dashd/.config.json`, with `DASHD_*` environment variables taking precedence. See [config.js](dashd/src/config.js):

```json
{ "agent": "codex", "usbHost": "192.168.2.1", "orientation": "portrait", "landscapeRotate": 90 }
```

Run tests with `npm test`. They include checks that frames use PNG `color_type 0`, which `eips` requires. Tests for the imported core are in `test/claude/`.

### Codex (default)

An installed, authenticated Codex CLI is required. `dashd` finds it in PATH or
inside Codex.app on macOS. Set `DASHD_CODEX_BIN` to provide an explicit path.
`npm start` reads existing chats and usage limits through a local app-server.
Monitoring does not create new model requests.

```bash
npm run install-hooks:codex
# Then, in Codex: /hooks — review and trust the new hooks.
```

If your terminal reports `command not found: codex`, run the CLI bundled with the app:

```bash
"/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"
```

Once the hooks are trusted, you can answer approval requests from the Kindle with
`Y` / `N` / `Back`. Without a connected Kindle or a running `dashd`, Codex uses
its normal approval interface. `/status` reports `hooks: true` after the first
event reaches the daemon.

The list shows up to 20 root chats from the past 24 hours, including completed
(IDLE) chats. Imported histories appear after their first run in Codex;
Guardian and internal subagents are hidden. Context and usage limits come from
Codex data. See [integration details and limitations (Russian)](docs/codex-integration.md).

### Claude Code (compatibility)

Run `npm run start:claude`, or set `agent: "claude"` in `.config.json`.

`dashd` discovers sessions without hooks by polling `claude agents --json` and reading transcripts. It retrieves limits from `claude -p "/usage"` once a minute. Hooks provide accurate session states and approval handling:

```bash
npm run install-hooks:claude     # Updates ~/.claude/settings.json, keeping a backup.
npm run uninstall-hooks:claude
```

The `install-hooks` / `uninstall-hooks` commands select the backend in the same way as `npm start`.
Claude hooks send events to `127.0.0.1:8765/hook` and are accepted only over loopback. If claude-thing hooks (`:8790`) are already installed, the installer refuses to continue: two approval bridges must not compete for the same response.

Approval request behavior:

- **Kindle connected** (polled `dashd` within the last ~35 seconds): the request appears on Queue and waits for a Kindle response for up to ~10 minutes. It then returns to the Mac, in the terminal or Claude app where the session is open.
- **Kindle disconnected**: the request goes straight to the terminal.
- **Kindle disconnects while a request is waiting**: the request returns to the terminal within a couple of seconds.
- **`dashd` is not running**: the hook fails, and Claude Code shows its normal prompt.

None of these cases automatically denies the request.

`npm run mock` starts `dashd` with fake sessions, an approval request every minute, and a question every 90 seconds. Use it to work on screens without a real Claude session.

## M0: connecting to the Kindle

**USB network addresses: Kindle `192.168.2.2`, Mac `192.168.2.1`.** These are the K3 USBNetwork defaults; no device-side address changes are needed. The `192.168.1.1/.2` addresses in older guides conflict with this setup's home network, `192.168.1.0/24`. If you change the USB addresses, update `/mnt/us/usbnet/etc/config`, dashd's `usbHost`, and `DASH_HOST` in the Kindle's local settings. In Wi-Fi mode, `DASH_HOST` uses the home network address independently of USBNetwork.

1. Connect the Kindle over USB as a storage device. If USBNetwork is not installed (no `/Volumes/Kindle/usbnet/`), download `kindle-usbnetwork-0.57.N-k3.zip` from the [MobileRead thread](https://www.mobileread.com/forums/showthread.php?t=88004). Copy the `.bin` for your model to the Kindle's root directory **with a lowercase filename** (`update_usbnetwork_0.57.N_k3w_install.bin`): the old 0.7.N jailbreak checks filenames against a case-sensitive allowlist. Then select Menu → Settings → Menu → Update Your Kindle. The defaults in `usbnet/etc/config` are `KINDLE_IP=192.168.2.2` and `HOST_IP=192.168.2.1`.
2. Copy the scripts while the Kindle is mounted as storage:
   ```bash
   ./scripts/kindle-deploy.sh
   ```
3. Eject the drive and unplug the cable. On the Kindle, press `Del` to open search, then enter `;debugOn`, `~usbNetwork`, and `;debugOff`, pressing Enter after each command. Reconnect the cable.
4. A “RNDIS/Ethernet Gadget” interface (`en10`) appears on the Mac. Configure it manually: System Settings → Network → RNDIS/Ethernet Gadget → Details → TCP/IP → Manually, `192.168.2.1` / `255.255.255.0`, leaving Router blank.
5. Install an SSH key once. Press Enter at the password prompt: over USB, dropbear accepts any password for root.
   ```bash
   ./scripts/kindle-ssh-setup.sh
   ```
   Subsequent connections are passwordless: `./scripts/kindle-ssh.sh` for a shell, or `./scripts/kindle-ssh.sh '<command>'`. The key is stored at `~/.ssh/kindle_k3`.
6. Run discovery on the Kindle through `./scripts/kindle-ssh.sh`. The script is interactive: it displays a test PNG and asks you to press each key in turn.
   ```sh
   sh /mnt/us/dash/discovery.sh
   ```
   Results are saved to `/mnt/us/dash/discovery.txt`. Transfer them to §10 of the specification, and update the key codes in `dashd/src/keys.js` and `KEY_EXIT` in `kindle/dash/config.sh`.
7. To return to storage mode, enter `;debugOn`, `~usbNetwork`, and `;debugOff` again on the Kindle. The USBNetwork command acts as a toggle.

## Wi-Fi operation

The Kindle fetches frames through your home router. You can unplug the cable or
use it to charge from a wall adapter or power bank. The Mac running `dashd` must
stay powered on and reachable on the same local network.

1. Press `Home` on the Kindle to exit the dashboard, then connect to your home
   2.4 GHz network under Menu → Settings → Wi-Fi Networks. This saves the
   profile in the stock wifid service.
2. On the Mac, from the repository root:
   ```bash
   node scripts/kindle-wifi-setup.mjs
   # Uses the en0 address by default; override with --host 192.168.1.247
   # or --interface en7 if the Mac connects to the router through another interface.
   ```
   This creates matching `dashd/.config.json` and `kindle/dash/network.local.sh`
   files with the Mac's address and a random 256-bit key. Both files are excluded
   from Git. Running setup again preserves the key and other daemon settings.
3. Restart `dashd`, then use the still-connected USB link:
   ```bash
   ./scripts/kindle-deploy.sh
   ./scripts/kindle-ssh.sh 'sh /mnt/us/dash/stop.sh; sh /mnt/us/dash/start.sh'
   ```
   At startup, the dashboard enables Wi-Fi and uses the saved network. USBNetwork
   settings and SSH access over USB stay unchanged; the dashboard does not need
   SSH over Wi-Fi.
4. Check the [local status endpoint](http://127.0.0.1:8765/status) for
   `kindleLinked: true`, `kindleTransport: "wifi"`, and the Kindle's home network
   IP in `kindleAddress`. You can now unplug the cable: frame requests and key
   presses travel over Wi-Fi.

The daemon binds only to the specific private `lanHost`; Wi-Fi requires a
`deviceToken`. The key is checked for `/version`, `/frame.png`, and `/key` on
all network connections, including USB after Wi-Fi setup. The Kindle's old
`wget` sends the key as an HTTP query parameter within the home network.
Hooks, `/status`, the preview, and `/dev/*` are available only over loopback,
even with a valid key. The token is not printed in logs. For manual configuration,
use `DASHD_LAN_HOST` and `DASHD_DEVICE_TOKEN`, or `lanHost` / `deviceToken` in `.config.json`.

Reserve the Mac's address in your router's DHCP settings. If the address changes,
run setup again, restart the daemon, and copy the settings to the Kindle over USB.
To return to sending frames over the cable, run
`node scripts/kindle-wifi-setup.mjs --usb`, then deploy and restart the client.
You do not need to remove the Kindle's Wi-Fi profile.

## Autostart and reconnection (M4)

Install the per-user LaunchAgent on the Mac once. Stop any manually started
`npm start` process first:

```bash
node scripts/dashd-service.mjs install
node scripts/dashd-service.mjs status
node scripts/dashd-service.mjs restart
# Disable autostart and stop the service:
node scripts/dashd-service.mjs uninstall
```

The daemon starts when you log in to macOS and restarts after its process exits.
The service uses absolute paths to Node and the repository, so it does not need
nvm or an interactive shell. Run `install` again after moving the repository or
removing the current Node version. Settings are read from `dashd/.config.json`;
the token is not copied into the plist. Log: `~/Library/Logs/kindle-dashboard/dashd.log`.
The service does not prevent Mac sleep; while the Mac sleeps, the Kindle shows
the offline screen.

After running `./scripts/kindle-deploy.sh`, configure Kindle autostart over USB SSH:

```bash
./scripts/kindle-ssh.sh 'sh /mnt/us/dash/autostart.sh enable'
# Disable future automatic starts only:
./scripts/kindle-ssh.sh 'sh /mnt/us/dash/autostart.sh disable'
# Remove the init script and its links:
./scripts/kindle-ssh.sh 'sh /mnt/us/dash/autostart.sh remove'
```

This installs a separate `/etc/init.d/kindle-dashboard` script that starts in
normal runlevel 5 once the framework is ready. Amazon scripts and USBNetwork
are not modified. If needed, the root filesystem is temporarily remounted for
installation, then restored to its original mount mode. `Home` stops the
dashboard until the next Kindle restart. To bypass autostart, create an empty
`/mnt/us/dash/DISABLED` file (`Kindle/dash/DISABLED` over USB storage); remove it
to enable autostart again. If USB storage is connected during boot, startup
waits up to four minutes for userstore to return to the device. You can still
start it manually with `sh /mnt/us/dash/start.sh`. Boot log: `/var/tmp/dash/boot.log`.

The client limits the duration of every network request. If Wi-Fi drops, the Mac
sleeps, or the daemon is unavailable, it shows a local **NO CONNECTION** screen,
stops sending key presses, and retries after 2, 4, 8, then 15 seconds. Wi-Fi uses
the saved stock profile. When the Mac or network returns, the dashboard resumes
automatically with a full screen refresh. `Home` works while offline too.

Each daemon start gets a new `epoch`: a reused frame number after a restart does
not block recovery, and a key press from an earlier run cannot answer a new
approval request. In the M4 protocol, the client sends `epoch` to `/version`,
`/frame.png`, and `/key`. The older `/version` format without this parameter
remains available.

## Ambient clock (M4)

After two minutes with no key presses, working sessions, or user requests, the
dashboard shows a large clock, the date, and the current agent's mascot. The
clock uses the Mac's local time and updates once a minute. Backend errors do
not count as a quiet state; the diagnostic screen is not hidden automatically.

Session activity restores the previous screen; a new request opens Queue.
Any key wakes the dashboard, while `S` / `Q` / `U` open the selected screen
directly. The first `Y` / `N` after the clock only wakes the screen. `Home`
returns to the stock Kindle UI. Set the threshold with `ambientAfterMs` in
`dashd/.config.json` or `DASHD_AMBIENT_AFTER_MS`; `0` disables automatic Ambient mode.

The top-right corner of Ambient and **NO CONNECTION** shows the Kindle's own
battery level: a battery icon and percentage, or a lightning bolt and percentage
while charging. Readings come from `powerd` (`battLevel`, `isCharging`). An
unknown level is shown as `--%`. The display updates when readings change,
usually within a minute. The indicator keeps working without the Mac on the
reconnection screen: the client selects a local PNG with the current charge.
`device-assets.js` generates these variants during deployment; the generated
`kindle/dash/offline/` directory is excluded from Git.

## M1: the rendering pipeline

Start `cd dashd && npm start` on the Mac and `sh /mnt/us/dash/start.sh` on the Kindle. The test screen should appear. Pressing any key displays its raw code in the LAST KEY block on the next frame. Exit with `sh /mnt/us/dash/stop.sh` over SSH, or with `Home` after discovery.

Use the portrait/landscape buttons in the preview to compare orientations; each frame is sent to the Kindle immediately.

## Screens and keys (M2)

- **Sessions.** Four session tiles stacked in portrait, or a 2×2 grid in landscape. Additional sessions are split into pages. The top bar shows `SESS total/active` on the left: the total number of listed sessions, followed by the number currently working or waiting for an answer or approval, across all pages. Weekly limit consumption appears as `7D …%` in the center, with the clock and Kindle battery on the right. Unknown usage is shown as `7D --%`. An inverted tile means ATTENTION: the session is waiting for a person. The state indicator is filled while working, checked when finished, hollow when idle, and dashed when the session has ended. A thick border marks the selected tile.
- **Session details.** Folder, model, elapsed time, current tool, context, and tokens. The latest message is shown in full across navigable pages.
- **Usage.** Limit bars from `claude /usage`, with ALL CLEAR / RUNNING OUT / OUT OF USAGE thresholds and a 24-hour breakdown.

| Key | Action |
|---|---|
| `S` / `Q` / `U` | Sessions / Queue / Usage |
| Page-turn buttons (both sides) | Next / previous screen |
| Five-way controller | Select a tile: ↑↓ moves one tile and ←→ changes pages in portrait; moves through the grid in landscape |
| Controller center | Open details for the selected session |
| In session details | Center raises the session window (Terminal tab or Claude app); ←→ selects a neighboring session; ↑↓ pages through the message; `Back` returns to the list |
| In Queue | `Y` allows (a destructive command requires a second press); `N` denies; `Back` sends the request to the Mac; ↑↓ selects a request; center raises the session window |
| `R` | Full screen refresh |
| `Menu` | M1 test screen (diagnostics) |
| `Home` | Exit the dashboard (handled on the Kindle itself) |

**Queue (M3).** An approval request opens this screen automatically. Once all requests are answered, the previous screen returns. A key press is accepted only if the request was actually on screen at that moment: the Kindle sends the version of the frame on which the key was pressed. Hooks cannot answer multiple-choice questions or plan confirmations, so the Kindle only displays them. Press the controller center to raise the session window and answer there.

## License

GPL-3.0 ([LICENSE](LICENSE)): `dashd/src/claude` was imported from claude-thing, which is distributed under GPL-3.0.
