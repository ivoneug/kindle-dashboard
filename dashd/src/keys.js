// Raw Kindle key code → dashboard action. The Kindle sends whatever waitforkey
// prints, verbatim: "<linux keycode> <value>", 1 = press, 0 = release (each
// is its own waitforkey call; keys.sh already drops releases). All meaning
// lives here, so remapping never touches the device.
//
// Codes from M0 discovery on the K3 (kindle-dashboard.md §10). Alt is a
// modifier and never reaches waitforkey.
export const KEY_NAMES = {
  21: 'Y', 49: 'N', 31: 'S', 16: 'Q', 22: 'U', 19: 'R', 46: 'C',
  158: 'BACK', 102: 'HOME', 139: 'MENU', 14: 'DEL',
  103: 'UP', 108: 'DOWN', 105: 'LEFT', 106: 'RIGHT', 194: 'CENTER',
  104: 'L-NEXT', 193: 'L-PREV', 191: 'R-NEXT', 109: 'R-PREV',
  126: 'SYM', 190: 'AA', 42: 'SHIFT', 28: 'ENTER', 57: 'SPACE',
  115: 'VOL+', 114: 'VOL-',
};

// kindle-dashboard.md §7.3. X, B, T stay free: reserved for the Xcode stage.
// HOME (exit) is handled on the Kindle itself (KEY_EXIT in kindle/dash/config.sh)
// so it works with the Mac gone; it never gets here.
export const ACTIONS = {
  Y: 'allow',
  N: 'deny',
  BACK: 'back',        // hand the request to the terminal / one level up
  UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right',
  CENTER: 'open',      // open / confirm; on a session tile, raise its terminal
  S: 'screen:sessions',
  Q: 'screen:queue',
  U: 'screen:usage',
  'L-NEXT': 'screen:next', 'R-NEXT': 'screen:next',
  'L-PREV': 'screen:prev', 'R-PREV': 'screen:prev',
  R: 'refresh',
  C: 'compact',
  MENU: 'menu',        // the M1 test card, as a diagnostic
};

// "21 1" → {press: true, name: 'Y', action: 'allow'}; unknown codes → nulls.
export function parseKey(code) {
  const [num, value = '1'] = String(code).trim().split(/\s+/);
  const name = KEY_NAMES[num] || null;
  return { press: value === '1', name, action: name ? ACTIONS[name] || null : null };
}
