# Sourced by every script in /mnt/us/dash. Busybox 1.7.2 ash: no bashisms, no
# grep -E, no wget timeouts.

# An ssh session's PATH is /usr/bin:/bin, but eips lives in /usr/sbin.
PATH=/usr/sbin:/sbin:/usr/bin:/bin
export PATH

# Mac end of the USB network link — dashd listens there (dashd usbHost).
# Must match HOST_IP in /mnt/us/usbnet/etc/config and stay out of the home
# LAN's subnet.
DASH_HOST=192.168.2.1
DASH_PORT=8765
BASE="http://$DASH_HOST:$DASH_PORT"

DIR=/mnt/us/dash
RUN=/var/tmp/dash            # tmpfs: frame, version, pids, logs

# eips: -g draws a PNG with a partial update, -f makes it a full (flashing) one.
EIPS_FULL="-f"
EIPS_PARTIAL=""

# Keeping the stock UI off the screen: "freeze" (killall -STOP cvm) or
# "stop" (/etc/init.d/framework stop). Freeze is enough on the K3: keys still
# reach waitforkey, and once resumed the UI repaints itself and does not
# replay the presses it missed.
UI_MODE=freeze

# Raw waitforkey output of the Home key. Handled on the Kindle itself, so the
# device can always be taken back even with the Mac gone.
KEY_EXIT="102 1"

# fetch SECS URL OUTFILE — wget with a watchdog. This busybox wget (1.7.2)
#  • has no timeout, so a request to a Mac that vanished mid-request (cable
#    pulled) would hang forever;
#  • refuses to overwrite an existing -O file (O_EXCL), so it always writes to
#    stdout and the shell does the redirect.
# The watchdog polls rather than sleeping the whole span: on the K3 a
# backgrounded subshell kept running after kill, so it has to notice by itself
# that wget is done.
fetch() {
  wget -q -O - "$2" > "$3" 2>/dev/null &
  _w=$!
  ( _i=0
    while [ "$_i" -lt "$1" ] && kill -0 "$_w" 2>/dev/null; do sleep 1; _i=$((_i + 1)); done
    kill "$_w" 2>/dev/null ) &
  wait "$_w"
}

# kill_dash — every process of ours: both loops, their watchdog subshells
# (which carry the same command line) and wgets still talking to dashd.
# busybox ps shows no arguments here, so /proc it is.
kill_dash() {
  for _p in $(ls /proc | grep '^[0-9]'); do
    [ "$_p" = "$$" ] && continue
    _c=$(tr '\0' ' ' 2>/dev/null < "/proc/$_p/cmdline")
    case "$_c" in
      "sh $DIR/client.sh "|"sh $DIR/keys.sh "|"wget "*"$DASH_HOST"*) kill "$_p" 2>/dev/null ;;
    esac
  done
  killall waitforkey 2>/dev/null
}
