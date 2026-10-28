#!/bin/sh
# Stops both loops and gives the screen back to the stock UI.
. /mnt/us/dash/config.sh

kill_dash
rm -f "$RUN/client.pid" "$RUN/keys.pid"

eips -c >/dev/null 2>&1
case "$UI_MODE" in
  stop) /etc/init.d/framework start ;;
  *)    killall -CONT cvm 2>/dev/null ;;
esac
killall -CONT powerd 2>/dev/null

echo "dash stopped"
