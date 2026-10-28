#!/bin/sh
# Run over USB: sh /mnt/us/dash/autostart.sh enable|disable|remove.
# One dedicated init script; no edits to Amazon/USBNetwork scripts.
set -e
. /mnt/us/dash/config.sh
SERVICE=/etc/init.d/kindle-dashboard
LINK=/etc/rc5.d/S99kindle-dashboard
[ -d /etc/rc5.d ] && [ -e /proc/bd/framework_running ] || { echo 'Requires the K3 SysV firmware'; exit 1; }

case "$1" in
  disable)
    rm -f "$DIR/autostart.enabled"
    echo 'Autostart disabled; current dashboard continues until Home or stop.sh.'
    exit 0 ;;
  enable|remove) ;;
  *) echo 'Usage: autostart.sh enable|disable|remove'; exit 1 ;;
esac

# Refuse to replace a file or link that belongs to someone else.
if [ -e "$SERVICE" ] && ! grep -q 'kindle-dashboard managed service' "$SERVICE"; then
  echo "Refusing to replace $SERVICE"; exit 1
fi
for L in "$LINK" /etc/rc0.d/K04kindle-dashboard /etc/rc1.d/K04kindle-dashboard /etc/rc2.d/K04kindle-dashboard /etc/rc6.d/K04kindle-dashboard; do
  if [ -e "$L" ] || [ -L "$L" ]; then
    [ "$(readlink "$L")" = ../init.d/kindle-dashboard ] || { echo "Refusing to replace $L"; exit 1; }
  fi
done
ROOT_WAS_RO=0
if awk '$1 == "/dev/root" && $2 == "/" {print $4}' /proc/mounts | grep -q '^ro[,]*'; then
  ROOT_WAS_RO=1
  mntroot rw
fi
restore_root() { [ "$ROOT_WAS_RO" != 1 ] || mntroot ro; }
trap restore_root EXIT
if [ "$1" = remove ]; then
  rm -f "$DIR/autostart.enabled" "$SERVICE" "$LINK" /etc/rc0.d/K04kindle-dashboard /etc/rc1.d/K04kindle-dashboard /etc/rc2.d/K04kindle-dashboard /etc/rc6.d/K04kindle-dashboard
  echo 'Autostart removed.'
else
  cp "$DIR/init.sh" "$SERVICE"
  chmod 755 "$SERVICE"
  ln -sf ../init.d/kindle-dashboard "$LINK"
  for LEVEL in 0 1 2 6; do ln -sf ../init.d/kindle-dashboard "/etc/rc$LEVEL.d/K04kindle-dashboard"; done
  touch "$DIR/autostart.enabled"
  echo 'Autostart enabled for normal boot. Home exits until next reboot; DISABLED on the USB drive bypasses startup.'
fi
sync
