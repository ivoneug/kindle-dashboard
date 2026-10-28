#!/bin/sh
# kindle-dashboard managed service; installed in /etc/init.d/kindle-dashboard.
# rc5 only: rc2/rc4 are diagnostic levels on this K3, not normal startup.
case "$1" in
  start)
    mkdir -p /var/tmp/dash
    # A USB host can temporarily own the userstore during boot. Wait off the
    # init path until it is mounted back, then check the opt-out on that disk.
    (trap '' HUP
      I=0
      while [ ! -f /mnt/us/dash/boot.sh ] && [ "$I" -lt 120 ]; do sleep 2; I=$((I + 1)); done
      [ -f /mnt/us/dash/autostart.enabled ] || exit 0
      [ ! -f /mnt/us/dash/DISABLED ] || exit 0
      exec sh /mnt/us/dash/boot.sh
    ) > /var/tmp/dash/boot.log 2>&1 &
    ;;
  stop)
    [ ! -f /mnt/us/dash/stop.sh ] || sh /mnt/us/dash/stop.sh --shutdown
    ;;
  *) echo "Usage: $0 start|stop"; exit 1 ;;
esac
