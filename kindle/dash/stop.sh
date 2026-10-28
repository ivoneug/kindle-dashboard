#!/bin/sh
# Stops both loops and gives the screen back to the stock UI.
. /mnt/us/dash/config.sh

kill_dash
rm -f "$RUN/client.pid" "$RUN/keys.pid"

eips -c >/dev/null 2>&1
case "$UI_MODE" in
  stop) /etc/init.d/framework start ;;
  *)
    killall -CONT cvm 2>/dev/null
    # SIGCONT alone need not dirty the stock window. Open/close Menu to make
    # it repaint after eips cleared our frame (the SysV KOReader exit method).
    if [ -w /proc/keypad ]; then
      echo 'send 139' > /proc/keypad
      echo 'send 139' > /proc/keypad
    fi
    ;;
esac
killall -CONT powerd 2>/dev/null
lipc-set-prop com.lab126.powerd preventScreenSaver 0 2>/dev/null

echo "dash stopped"
