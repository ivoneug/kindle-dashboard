#!/bin/sh
# Shows whatever dashd has. Long-poll /version until it differs from what is on
# screen, fetch that frame, draw it. "N full" means draw it with a full
# refresh. All layout and logic live on the Mac.
. /mnt/us/dash/config.sh
mkdir -p "$RUN"
cd "$RUN" || exit 1

V=0
while :; do
  # dashd holds this for up to 25 s; the watchdog only fires if it is gone.
  fetch 40 "$BASE/version?since=$V" "$RUN/version.resp" || { sleep 2; continue; }
  RESP=$(cat "$RUN/version.resp")
  NEW=${RESP%% *}
  case "$NEW" in ''|*[!0-9]*) sleep 2; continue ;; esac
  [ "$NEW" = "$V" ] && continue

  if fetch 20 "$BASE/frame.png?v=$NEW" "$RUN/frame.tmp"; then
    mv "$RUN/frame.tmp" "$RUN/frame.png"
    case "$RESP" in
      *full*) eips $EIPS_FULL -g "$RUN/frame.png" >/dev/null 2>&1 ;;
      *)      eips $EIPS_PARTIAL -g "$RUN/frame.png" >/dev/null 2>&1 ;;
    esac
    V=$NEW
    # keys.sh sends this with every press: dashd only acts on a key if the
    # frame it was pressed on is still the current one.
    echo "$V" > "$RUN/version"
  else
    sleep 1
  fi
done
