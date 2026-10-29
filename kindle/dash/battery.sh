#!/bin/sh
# Sourced after config.sh. powerd stays alive while the dashboard owns the UI.
# Unknown values are explicit; do not turn a failed LIPC read into 0%.
read_battery() {
  BATTERY_LEVEL=$(lipc-get-prop com.lab126.powerd battLevel 2>/dev/null | tr -d '\r\n')
  case "$BATTERY_LEVEL" in
    ''|*[!0-9]*) BATTERY_LEVEL=unknown ;;
    *)
      if [ "${#BATTERY_LEVEL}" -gt 3 ]; then BATTERY_LEVEL=unknown
      else
        while [ "${#BATTERY_LEVEL}" -gt 1 ] && [ "${BATTERY_LEVEL#0}" != "$BATTERY_LEVEL" ]; do BATTERY_LEVEL=${BATTERY_LEVEL#0}; done
        [ "$BATTERY_LEVEL" -le 100 ] || BATTERY_LEVEL=unknown
      fi ;;
  esac
  BATTERY_CHARGING=$(lipc-get-prop com.lab126.powerd isCharging 2>/dev/null | tr -d '\r\n')
  case "$BATTERY_CHARGING" in 0|1) ;; *) BATTERY_CHARGING=unknown ;; esac
}

offline_frame() {
  _charge=$BATTERY_CHARGING
  [ "$_charge" = 1 ] || _charge=0
  _frame="$DIR/offline/$BATTERY_LEVEL-$_charge.png"
  if [ -f "$_frame" ]; then printf '%s\n' "$_frame"; else printf '%s\n' "$DIR/offline.png"; fi
}
