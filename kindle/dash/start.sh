#!/bin/sh
# Takes the screen over: wakes the device and keeps the screensaver off,
# parks the stock UI, starts the frame and key loops. Undo with stop.sh.
. /mnt/us/dash/config.sh
mkdir -p "$RUN"

if [ -f "$RUN/client.pid" ] && kill -0 "$(cat "$RUN/client.pid")" 2>/dev/null; then
  echo "dash already running"
  exit 0
fi

if [ "$DASH_WIFI" = 1 ] && [ -z "$DASH_TOKEN" ]; then
  echo "Wi-Fi is missing its dashboard token — run kindle-wifi-setup.mjs"
  exit 1
fi

# powerd stays running (it minds the battery); it is only told to keep the
# screensaver away. A start from an older version may have frozen it.
killall -CONT powerd 2>/dev/null
# In the screensaver the keypad is off, and with the UI frozen nothing would
# ever wake it: the dashboard would draw but never hear a key (seen on the K3).
if [ "$(lipc-get-prop com.lab126.powerd state 2>/dev/null)" != "active" ]; then
  lipc-set-prop com.lab126.powerd wakeUp 1 2>/dev/null
  sleep 2
fi
if [ "$(lipc-get-prop com.lab126.powerd state 2>/dev/null)" != "active" ]; then
  echo "Kindle is asleep — wake it (power switch), then run start.sh again"
  exit 1
fi
lipc-set-prop com.lab126.powerd preventScreenSaver 1 2>/dev/null

# wifid owns the saved network profile and reconnects it when enabled. Do not
# change USBNetwork/sshd settings: USB remains available for maintenance.
if [ "$DASH_WIFI" = 1 ]; then
  lipc-set-prop com.lab126.wifid enable 1 2>/dev/null
fi

case "$UI_MODE" in
  stop) /etc/init.d/framework stop ;;
  *)    killall -STOP cvm 2>/dev/null ;;
esac
eips -c >/dev/null 2>&1
rm -f "$RUN/version"

# Ignoring HUP keeps both loops alive after the ssh session that started them
# closes; exec keeps the recorded pid the loop's own.
(trap '' HUP; exec sh "$DIR/client.sh") > "$RUN/client.log" 2>&1 &
echo $! > "$RUN/client.pid"
(trap '' HUP; exec sh "$DIR/keys.sh") > "$RUN/keys.log" 2>&1 &
echo $! > "$RUN/keys.pid"

echo "dash started → $BASE"
