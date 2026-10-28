#!/bin/sh
# Long-poll with bounded requests, local offline display and daemon generations.
# Only a successfully drawn frame enables keys; offline keys are never queued.
. /mnt/us/dash/config.sh
mkdir -p "$RUN"
cd "$RUN" || exit 1

V=0
EPOCH=
OFFLINE=0
DELAY=2

lost_connection() {
  V=0
  EPOCH=
  rm -f "$RUN/shown" "$RUN/version"
  if [ "$OFFLINE" = 0 ]; then
    if [ -f "$DIR/offline.png" ]; then
      eips -f -g "$DIR/offline.png" >/dev/null 2>&1
    else
      eips -c >/dev/null 2>&1
      eips 2 12 'NO CONNECTION' >/dev/null 2>&1
      eips 2 14 'Reconnecting automatically' >/dev/null 2>&1
      eips 2 16 'Home: return to Kindle' >/dev/null 2>&1
    fi
    echo 'offline; retrying automatically'
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
  fetch 32 "$BASE/version?since=$V&epoch=$EPOCH" "$RUN/version.resp" || { lost_connection; continue; }
  RESP=$(cat "$RUN/version.resp")
  set -- $RESP
  NEW=$1
  case "$NEW" in ''|*[!0-9]*|0) lost_connection; continue ;; esac
  NEXT_EPOCH=
  FULL=0
  for FIELD in "$@"; do
    case "$FIELD" in full) FULL=1 ;; epoch=*) NEXT_EPOCH=${FIELD#epoch=} ;; esac
  done
  case "$NEXT_EPOCH" in ''|*[!0-9a-f]*) lost_connection; continue ;; esac
  [ "${#NEXT_EPOCH}" = 32 ] || { lost_connection; continue; }
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
    if [ "$?" != 0 ]; then lost_connection; continue; fi
    mv "$RUN/frame.tmp" "$RUN/frame.png"
    V=$NEW
    EPOCH=$NEXT_EPOCH
    printf '%s %s\n' "$V" "$EPOCH" > "$RUN/shown.tmp"
    mv "$RUN/shown.tmp" "$RUN/shown"
    echo "$V" > "$RUN/version"
    [ "$OFFLINE" = 0 ] || echo 'connected; screen restored'
    OFFLINE=0
    DELAY=2
  else
    lost_connection
  fi
done
