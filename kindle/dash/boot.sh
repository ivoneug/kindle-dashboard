#!/bin/sh
# Wait off the boot path; never freeze Java while it is still initializing.
. /mnt/us/dash/config.sh
mkdir -p "$RUN"
if [ -f "$RUN/boot.pid" ] && kill -0 "$(cat "$RUN/boot.pid")" 2>/dev/null; then exit 0; fi
echo $$ > "$RUN/boot.pid"
trap 'rm -f "$RUN/boot.pid"' EXIT
trap 'exit 0' TERM INT

I=0
while [ "$I" -lt 120 ]; do
  [ -f "$DIR/autostart.enabled" ] && [ ! -f "$DIR/DISABLED" ] || exit 0
  READY=$(cat /proc/bd/framework_running 2>/dev/null)
  if { [ "$READY" = 1 ] || [ "$READY" = 00000001 ]; } &&
     [ "$(lipc-get-prop com.lab126.powerd state 2>/dev/null)" = active ]; then
    # boot_finished still performs its last display/governor updates.
    sleep 5
    [ -f "$DIR/autostart.enabled" ] && [ ! -f "$DIR/DISABLED" ] || exit 0
    sh "$DIR/start.sh"
    exit $?
  fi
  sleep 2
  I=$((I + 1))
done
echo 'Framework not ready after 4 minutes; leaving the stock UI available.'
exit 1
