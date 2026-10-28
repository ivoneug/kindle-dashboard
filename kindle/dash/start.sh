#!/bin/sh
# Takes the screen over: parks the stock UI, keeps the device awake, starts
# the frame and key loops. Undo with stop.sh.
. /mnt/us/dash/config.sh
mkdir -p "$RUN"

if [ -f "$RUN/client.pid" ] && kill -0 "$(cat "$RUN/client.pid")" 2>/dev/null; then
  echo "dash already running"
  exit 0
fi

case "$UI_MODE" in
  stop) /etc/init.d/framework stop ;;
  *)    killall -STOP cvm 2>/dev/null ;;
esac
killall -STOP powerd 2>/dev/null
eips -c >/dev/null 2>&1
rm -f "$RUN/version"

# Ignoring HUP keeps both loops alive after the ssh session that started them
# closes; exec keeps the recorded pid the loop's own.
(trap '' HUP; exec sh "$DIR/client.sh") > "$RUN/client.log" 2>&1 &
echo $! > "$RUN/client.pid"
(trap '' HUP; exec sh "$DIR/keys.sh") > "$RUN/keys.log" 2>&1 &
echo $! > "$RUN/keys.pid"

echo "dash started → $BASE"
