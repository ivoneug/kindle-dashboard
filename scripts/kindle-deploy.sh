#!/usr/bin/env bash
# Copies kindle/dash/ to /mnt/us/dash on the Kindle:
#   • to the mounted USB drive (/Volumes/Kindle) if the Kindle is in USB
#     storage mode — the only way in before USB networking works;
#   • otherwise over ssh to $KINDLE (default 192.168.2.2).
#
#   ./scripts/kindle-deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

KINDLE="${KINDLE:-192.168.2.2}"
# Key from kindle-ssh-setup.sh; USBNetwork 0.57.N's dropbear speaks modern
# key exchange, no legacy options needed.
SSH_OPTS=(
  -i "$HOME/.ssh/kindle_k3" -o IdentitiesOnly=yes -o BatchMode=yes
  -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -o LogLevel=ERROR
)

node dashd/scripts/test-png.js >/dev/null

if [ -d /Volumes/Kindle ]; then
  mkdir -p /Volumes/Kindle/dash
  cp -X kindle/dash/* /Volumes/Kindle/dash/
  # macOS still leaves AppleDouble ._ files on FAT; they are noise there.
  rm -f /Volumes/Kindle/dash/._*
  echo "copied to /Volumes/Kindle/dash — eject the Kindle before enabling usbNetwork"
else
  ssh "${SSH_OPTS[@]}" "root@$KINDLE" 'mkdir -p /mnt/us/dash'
  # -O: the legacy scp protocol, no sftp-server needed on the Kindle.
  scp -O "${SSH_OPTS[@]}" kindle/dash/* "root@$KINDLE:/mnt/us/dash/"
  echo "copied to root@$KINDLE:/mnt/us/dash"
fi
