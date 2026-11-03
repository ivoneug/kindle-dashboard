#!/bin/sh
# Home-screen entry for the Kindle 3 Kite launcher.
set -e
PATH=/usr/sbin:/sbin:/usr/bin:/bin
export PATH
ENTRY=/mnt/us/kite/Dashboard
MARKER='kindle-dashboard managed shortcut'

case "$1" in
  install|remove)
    if [ -e "$ENTRY" ] && ! grep -q "$MARKER" "$ENTRY"; then
      echo "Refusing to replace $ENTRY"
      exit 1
    fi
    if [ "$1" = remove ]; then
      rm -f "$ENTRY"
      echo 'Dashboard shortcut removed.'
    else
      [ -x /sbin/kite ] || { echo 'Install Kite for Kindle 3 first.'; exit 1; }
      mkdir -p /mnt/us/kite
      # Publish a complete script: Kite watches new files in this directory.
      cat > /mnt/us/dash/shortcut-entry.tmp <<'EOF'
#!/bin/sh
# kindle-dashboard managed shortcut
exec sh /mnt/us/dash/shortcut.sh launch
EOF
      chmod 755 /mnt/us/dash/shortcut-entry.tmp
      mv /mnt/us/dash/shortcut-entry.tmp "$ENTRY"
      echo 'Dashboard shortcut installed in the stock library.'
    fi
    ;;
  launch)
    mkdir -p /var/tmp/dash
    # Let the library finish opening the Kite entry before parking its UI.
    # Detach so returning from Kite cannot terminate the dashboard startup.
    (trap '' HUP
      sleep 2
      exec sh /mnt/us/dash/start.sh
    ) > /var/tmp/dash/shortcut.log 2>&1 < /dev/null &
    ;;
  *) echo 'Usage: shortcut.sh install|remove|launch'; exit 1 ;;
esac
