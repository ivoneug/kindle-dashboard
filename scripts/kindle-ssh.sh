#!/usr/bin/env bash
# ssh to the Kindle with the key from kindle-ssh-setup.sh; never prompts.
#
#   ./scripts/kindle-ssh.sh                 # shell
#   ./scripts/kindle-ssh.sh 'eips -c'       # one command
set -euo pipefail
KINDLE="${KINDLE:-192.168.2.2}"
TTY=()
[ $# -eq 0 ] && TTY=(-t)
# ${TTY[@]+…}: macOS bash 3.2 calls an empty array unbound under set -u.
exec ssh ${TTY[@]+"${TTY[@]}"} -i "$HOME/.ssh/kindle_k3" -o IdentitiesOnly=yes -o BatchMode=yes \
  -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -o LogLevel=ERROR "root@$KINDLE" "$@"
