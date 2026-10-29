#!/bin/sh
# Long-poll with bounded requests, local offline display and daemon generations.
# Only a successfully drawn frame enables keys; offline keys are never queued.
. /mnt/us/dash/config.sh
. "$DIR/battery.sh"
mkdir -p "$RUN"
cd "$RUN" || exit 1

V=0
EPOCH=
OFFLINE=0
DELAY=2
OFFLINE_BATTERY=
OFFLINE_UPDATES=0
LAST_FAILURE=

client_log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

lost_connection() {
  # Log stages and exit codes, never request URLs (which contain the token).
  # Repeated failures of the same kind should not fill the Kindle's tmpfs.
  if [ "$OFFLINE" = 0 ] || [ "$LAST_FAILURE" != "$1" ]; then
    client_log "offline: $1; retrying automatically"
  fi
  LAST_FAILURE=$1
  V=0
  EPOCH=
  rm -f "$RUN/shown" "$RUN/version"
  read_battery
  BATTERY_KEY="$BATTERY_LEVEL $BATTERY_CHARGING"
  if [ "$OFFLINE" = 0 ] || [ "$OFFLINE_BATTERY" != "$BATTERY_KEY" ]; then
    OFFLINE_FRAME=$(offline_frame)
    if [ -f "$OFFLINE_FRAME" ]; then
      if [ "$OFFLINE" = 0 ] || [ "$OFFLINE_UPDATES" -ge 10 ]; then
        eips -f -g "$OFFLINE_FRAME" >/dev/null 2>&1
        OFFLINE_UPDATES=0
      else
        eips -g "$OFFLINE_FRAME" >/dev/null 2>&1
        OFFLINE_UPDATES=$((OFFLINE_UPDATES + 1))
      fi
    else
      eips -c >/dev/null 2>&1
      eips 2 12 'NO CONNECTION' >/dev/null 2>&1
      eips 2 14 'Reconnecting automatically' >/dev/null 2>&1
      eips 2 16 'Home: return to Kindle' >/dev/null 2>&1
    fi
    OFFLINE_BATTERY=$BATTERY_KEY
    OFFLINE=1
  fi
  # wifid owns reconnection; restore its radio only if explicitly disabled.
  if [ "$DASH_WIFI" = 1 ] && [ "$(lipc-get-prop com.lab126.wifid enable 2>/dev/null)" = 0 ]; then
    lipc-set-prop com.lab126.wifid enable 1 2>/dev/null
  fi
  sleep "$DELAY"
  DELAY=$((DELAY * 2))
  [ "$DELAY" -le 15 ] || DELAY=15
}

while :; do
  # Normal long-poll is 25s. A vanished/sleeping Mac cannot strand wget.
  read_battery
  fetch 32 "$BASE/version?since=$V&epoch=$EPOCH&battery=$BATTERY_LEVEL&charging=$BATTERY_CHARGING" "$RUN/version.resp" || {
    FETCH_EXIT=$?
    lost_connection "version request failed (exit $FETCH_EXIT)"
    continue
  }
  RESP=$(cat "$RUN/version.resp")
  set -- $RESP
  NEW=$1
  case "$NEW" in ''|*[!0-9]*|0) lost_connection 'invalid version reply'; continue ;; esac
  NEXT_EPOCH=
  FULL=0
  for FIELD in "$@"; do
    case "$FIELD" in full) FULL=1 ;; epoch=*) NEXT_EPOCH=${FIELD#epoch=} ;; esac
  done
  case "$NEXT_EPOCH" in ''|*[!0-9a-f]*) lost_connection 'invalid daemon epoch'; continue ;; esac
  [ "${#NEXT_EPOCH}" = 32 ] || { lost_connection 'invalid daemon epoch length'; continue; }
  if [ "$NEW" = "$V" ] && [ "$NEXT_EPOCH" = "$EPOCH" ] && [ "$OFFLINE" = 0 ]; then
    DELAY=2
    continue
  fi

  if fetch 15 "$BASE/frame.png?v=$NEW&epoch=$NEXT_EPOCH" "$RUN/frame.tmp"; then
    if [ "$FULL" = 1 ] || [ "$OFFLINE" = 1 ] || [ "$EPOCH" != "$NEXT_EPOCH" ]; then
      eips $EIPS_FULL -g "$RUN/frame.tmp" >/dev/null 2>&1
    else
      eips $EIPS_PARTIAL -g "$RUN/frame.tmp" >/dev/null 2>&1
    fi
    DRAW_EXIT=$?
    if [ "$DRAW_EXIT" != 0 ]; then lost_connection "frame draw failed (exit $DRAW_EXIT)"; continue; fi
    mv "$RUN/frame.tmp" "$RUN/frame.png"
    V=$NEW
    EPOCH=$NEXT_EPOCH
    printf '%s %s\n' "$V" "$EPOCH" > "$RUN/shown.tmp"
    mv "$RUN/shown.tmp" "$RUN/shown"
    echo "$V" > "$RUN/version"
    [ "$OFFLINE" = 0 ] || client_log "connected; screen restored (v$V)"
    OFFLINE=0
    LAST_FAILURE=
    DELAY=2
  else
    FETCH_EXIT=$?
    lost_connection "frame download failed (exit $FETCH_EXIT)"
  fi
done
