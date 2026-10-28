#!/usr/bin/env bash
# One-time: a dedicated SSH key for the Kindle, so scripts (and Claude) can log
# in without a password prompt. Over USB, USBNetwork's dropbear accepts any
# password for root — press Enter when asked, once.
#
#   ./scripts/kindle-ssh-setup.sh
#
# The key goes into usbnet/etc/authorized_keys (where USBNetwork keeps it
# across toggles) and into root's live ~/.ssh, so it works right away.
set -euo pipefail

KINDLE="${KINDLE:-192.168.2.2}"
KEY="$HOME/.ssh/kindle_k3"

# ECDSA: dropbear 2015.68 predates ed25519.
[ -f "$KEY" ] || ssh-keygen -q -t ecdsa -b 256 -N '' -C kindle-dashboard -f "$KEY"

echo "Password prompt from the Kindle: just press Enter."
ssh -o StrictHostKeyChecking=accept-new -o PubkeyAuthentication=no "root@$KINDLE" '
  K=$(cat)
  umask 077
  for f in /mnt/us/usbnet/etc/authorized_keys "$HOME/.ssh/authorized_keys"; do
    mkdir -p "$(dirname "$f")"
    grep -qxF "$K" "$f" 2>/dev/null || echo "$K" >> "$f"
  done
  chmod 700 "$HOME/.ssh"; chmod 600 "$HOME/.ssh/authorized_keys"
' < "$KEY.pub"

"$(dirname "$0")/kindle-ssh.sh" 'echo "key login ok: $(uname -n)"'
