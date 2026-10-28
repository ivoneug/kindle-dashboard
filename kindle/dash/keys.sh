#!/bin/sh
# Sends every key press to dashd, raw, with the version of the frame on screen.
# What a key means is decided on the Mac (dashd/src/keys.js). Only the exit key
# is handled here, so the Kindle can always be taken back.
. /mnt/us/dash/config.sh
mkdir -p "$RUN"

while :; do
  KEY=$(waitforkey 2>/dev/null)
  [ -z "$KEY" ] && { sleep 1; continue; }
  # "<code> 1" is the press, "<code> 0" the release; only presses mean anything.
  case "$KEY" in *" 0") continue ;; esac

  if [ -n "$KEY_EXIT" ] && [ "$KEY" = "$KEY_EXIT" ]; then
    sh "$DIR/stop.sh" > "$RUN/stop.log" 2>&1 &
    exit 0
  fi

  SHOWN=$(cat "$RUN/shown" 2>/dev/null)
  [ -n "$SHOWN" ] || continue
  V=${SHOWN%% *}
  EPOCH=${SHOWN#* }
  CODE=$(echo "$KEY" | tr ' ' '+')
  # In the background: with the Mac gone the request can take until the
  # watchdog, and the loop must keep reading keys (the exit key above most of
  # all).
  fetch 10 "$BASE/key?code=$CODE&v=$V&epoch=$EPOCH" /dev/null &
done
