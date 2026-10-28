#!/bin/sh
# M0 discovery (kindle-dashboard.md §6.2). Needs no terminal input — the key
# probe draws its prompts on the Kindle's own screen — so it runs as a plain
# ssh command:
#   ./scripts/kindle-ssh.sh 'sh /mnt/us/dash/discovery.sh [info|screen|keys [KEY…]]'
# No argument runs all three; keys with names probes only those. Output:
# stdout and /mnt/us/dash/discovery.txt.
. /mnt/us/dash/config.sh
mkdir -p "$RUN"
OUT="$DIR/discovery.txt"
WHAT="${1:-all}"
[ $# -gt 0 ] && shift
KEYS="$*"
[ -n "$KEYS" ] || KEYS="Y N S Q U R Back Home Menu Del
  Joy-Up Joy-Down Joy-Left Joy-Right Joy-Center
  Left-NextPage Left-PrevPage Right-NextPage Right-PrevPage
  Sym Aa Shift Alt Enter Space Vol-Up Vol-Down"

say() { echo "$*" | tee -a "$OUT"; }
run() {
  say ""
  say "### $*"
  sh -c "$*" 2>&1 | tee -a "$OUT"
}

if [ "$WHAT" = all ] || [ "$WHAT" = info ]; then
  run 'uname -a; cat /etc/prettyversion.txt'
  run 'busybox 2>&1 | head -1'
  run 'wget --help 2>&1 | head -4'
  run 'eips 2>&1 | head -2'
  run 'eips -i | grep -e xres -e yres -e bits_per_pixel -e rotate'
  run 'cat /proc/bus/input/devices | grep -e Name -e Handlers'
  run 'ls /usr/bin /usr/sbin /bin /sbin | grep -i -e play -e snd -e sound -e mixer -e alsa'
  run 'ps | grep -e cvm -e powerd -e volumd | grep -v grep'
fi

# ---- screen: does eips draw our PNG, and how do the two refreshes look -----
if [ "$WHAT" = all ] || [ "$WHAT" = screen ]; then
  say ""
  say "### eips test (cvm frozen)"
  killall -STOP cvm powerd 2>/dev/null
  eips -c >/dev/null 2>&1
  say "partial: $(eips -g "$DIR/test.png" 2>&1; echo rc=$?)"
  sleep 3
  say "full:    $(eips -f -g "$DIR/test.png" 2>&1; echo rc=$?)"
  sleep 3
  killall -CONT cvm powerd 2>/dev/null
fi

# ---- keys: what waitforkey prints, with the UI frozen ----------------------
# Each key gets 15 s; <nothing> means it never reached waitforkey.
if [ "$WHAT" = all ] || [ "$WHAT" = keys ]; then
  say ""
  say "### waitforkey (cvm frozen)"
  killall -STOP cvm powerd 2>/dev/null
  eips -c >/dev/null 2>&1
  eips 2 2 "KEY PROBE - press the key named below" >/dev/null 2>&1
  eips 2 3 "(15 s each; wait it out to skip a key)" >/dev/null 2>&1
  # Gate: nothing starts timing out until someone is at the Kindle. This first
  # press is also the answer to "do keys reach waitforkey with cvm frozen?".
  eips 2 6 "$(printf 'Press:  %-16s' 'ANY KEY to start')" >/dev/null 2>&1
  rm -f "$RUN/k.out"
  ( waitforkey > "$RUN/k.out" 2>&1 ) &
  P=$!
  i=0
  while kill -0 "$P" 2>/dev/null && [ "$i" -lt 600 ]; do sleep 1; i=$((i + 1)); done
  kill "$P" 2>/dev/null
  killall waitforkey 2>/dev/null
  START=$(cat "$RUN/k.out" 2>/dev/null)
  say "start: ${START:-<nothing in 10 min, probe skipped>}"
  [ -n "$START" ] || KEYS=""
  for name in $KEYS; do
    eips 2 6 "$(printf 'Press:  %-16s' "$name")" >/dev/null 2>&1
    rm -f "$RUN/k.out"
    ( waitforkey > "$RUN/k.out" 2>&1 ) &
    P=$!
    i=0
    while kill -0 "$P" 2>/dev/null && [ "$i" -lt 15 ]; do sleep 1; i=$((i + 1)); done
    kill "$P" 2>/dev/null
    killall waitforkey 2>/dev/null
    KEY=$(cat "$RUN/k.out" 2>/dev/null)
    say "$name: ${KEY:-<nothing>}"
    eips 2 8 "$(printf 'got:    %-16s' "${KEY:-nothing}")" >/dev/null 2>&1
  done
  eips -c >/dev/null 2>&1
  eips 2 2 "KEY PROBE DONE" >/dev/null 2>&1
  killall -CONT cvm powerd 2>/dev/null
fi

say ""
say "done -> $OUT"
