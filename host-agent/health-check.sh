#!/usr/bin/env bash
# home-dashboard host agent. Runs as root from a systemd timer (every 5 minutes)
# and writes one JSON file with this host's stats, disks and health checks.
# The dashboard only reads that file; this script changes nothing on the host.
#
#   OUT=/var/lib/home-dashboard/health.json   where to write
#   RESTIC_STATUS=/var/lib/restic/last.json   optional: {"ok":true,"at":"...","added":"2.1 GB"}
#   RESTIC_CHECK_STATUS=/var/lib/restic/check.json  optional, same shape
#   CERT_HOST=tiny.<tailnet>.ts.net           optional: check this HTTPS certificate
#
# Needs: bash, coreutils, jq, smartmontools (smartctl). Optional: vcgencmd (Pi).
set -uo pipefail

OUT="${OUT:-/var/lib/home-dashboard/health.json}"
NOW="$(date -Iseconds)"
mkdir -p "$(dirname "$OUT")"
TMP="$(mktemp "${OUT}.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
checks='[]'

add_check() { # id name level result detail lastRun
  checks="$(jq -c --arg id "$1" --arg name "$2" --arg level "$3" --arg result "$4" --arg detail "$5" --arg lastRun "${6:-$NOW}" \
    '. + [{id:$id,name:$name,level:$level,result:$result,detail:$detail,lastRun:$lastRun}]' <<<"$checks")"
}

# ---- Stats -------------------------------------------------------------------
read -r _ u n s idle iow irq sirq _ < /proc/stat
sleep 1
read -r _ u2 n2 s2 idle2 iow2 irq2 sirq2 _ < /proc/stat
busy=$(( (u2+n2+s2+irq2+sirq2) - (u+n+s+irq+sirq) ))
total=$(( busy + (idle2+iow2) - (idle+iow) ))
cpu=$(( total > 0 ? busy * 100 / total : 0 ))
mem_total=$(awk '/MemTotal/ {print $2*1024}' /proc/meminfo)
mem_avail=$(awk '/MemAvailable/ {print $2*1024}' /proc/meminfo)
uptime_s=$(cut -d. -f1 /proc/uptime)
temp=null
if [ -r /sys/class/thermal/thermal_zone0/temp ]; then
  temp=$(awk '{printf "%.1f", $1/1000}' /sys/class/thermal/thermal_zone0/temp)
fi

# CPU history: keep the last 72 samples (6 hours at 5 minutes) next to the output
HIST="${OUT%.json}.cpu"
echo "$cpu" >> "$HIST"
tail -n 72 "$HIST" > "$HIST.tmp" && mv "$HIST.tmp" "$HIST"
cpu_history=$(jq -sc '.' "$HIST")

# ---- Disks: real filesystems only ---------------------------------------------
disks=$(df -B1 --output=source,fstype,size,used,target \
    -x tmpfs -x devtmpfs -x overlay -x squashfs -x vfat -x efivarfs -x 9p -x rootfs -x fuse.snapfuse 2>/dev/null \
  | tail -n +2 \
  | jq -Rsc 'split("\n") | map(select(length > 0) | [splits(" +")])
      | map({device: .[0], fs: .[1], total: (.[2] | tonumber), used: (.[3] | tonumber), mount: (.[4:] | join(" "))})
      | map(select(.total > 0 and (.mount | test("^/(snap|usr/lib/wsl|usr/src|boot/efi|init)") | not)))
      | map(. + {label: (if .mount == "/" then "root" else .mount end)})')

# ---- SMART (needs root) -------------------------------------------------------
if command -v smartctl >/dev/null; then
  for dev in $(smartctl --scan | awk '{print $1}'); do
    name=$(basename "$dev")
    j=$(smartctl -j -H -A -l selftest "$dev" 2>/dev/null) || true
    [ -z "$j" ] && continue
    passed=$(jq -r '.smart_status.passed // empty' <<<"$j")
    t=$(jq -r '.temperature.current // empty' <<<"$j")
    wear=$(jq -r '.nvme_smart_health_information_log.percentage_used // empty' <<<"$j")
    realloc=$(jq -r '[.ata_smart_attributes.table[]? | select(.id==5) | .raw.value][0] // empty' <<<"$j")
    last=$(jq -r '(.nvme_self_test_log.table // .ata_smart_self_test_log.standard.table // [])[0] | .status.string // empty' <<<"$j")
    detail=""
    [ -n "$wear" ] && detail="wear ${wear}%"
    [ -n "$realloc" ] && detail="${realloc} reallocated"
    [ -n "$t" ] && detail="${detail:+$detail · }${t} °C"
    [ -n "$last" ] && detail="${detail:+$detail · }last test: ${last}"
    if [ "$passed" = "true" ]; then
      level=ok; result=Passed
      if [ -n "$realloc" ] && [ "$realloc" -gt 0 ]; then level=warn; result="Reallocated sectors"; fi
      if [ -n "$wear" ] && [ "$wear" -ge 80 ]; then level=warn; result="Worn"; fi
    elif [ "$passed" = "false" ]; then level=bad; result=Failing
    else level=unknown; result="No SMART data"; fi
    add_check "smart-$name" "SMART health · $name" "$level" "$result" "$detail"
  done
fi

# ---- Kernel log: disk and filesystem errors in the last 7 days -----------------
errs=$(journalctl -k --since "-7 days" -q --no-pager 2>/dev/null | grep -Eci 'I/O error|EXT4-fs error|BTRFS error|mmc.*error|blk_update_request' || true)
if [ "${errs:-0}" -gt 0 ]; then add_check kernel-disk-errors "Disk errors (kernel log)" warn "$errs found" "last 7 days"
else add_check kernel-disk-errors "Disk errors (kernel log)" ok "None" "last 7 days"; fi

# ---- Filesystem check at boot ------------------------------------------------
fsck_fail=$(journalctl -b -q --no-pager -u 'systemd-fsck*' 2>/dev/null | grep -Eci 'error|corrupt|UNEXPECTED' || true)
boot_at=$(date -Iseconds -d "@$(( $(date +%s) - uptime_s ))")
if [ "${fsck_fail:-0}" -gt 0 ]; then add_check fsck "Filesystem check at boot" bad "Errors" "see journalctl -b -u systemd-fsck*" "$boot_at"
else add_check fsck "Filesystem check at boot" ok "Clean" "" "$boot_at"; fi

# ---- Failed systemd units ----------------------------------------------------
failed=$(systemctl list-units --state=failed --no-legend --plain 2>/dev/null | awk '{print $1}')
count=$(grep -c . <<<"$failed" || true)
if [ "${count:-0}" -gt 0 ]; then add_check systemd-failed "Failed systemd units" bad "$count" "$(paste -sd ', ' <<<"$failed")"
else add_check systemd-failed "Failed systemd units" ok "0" ""; fi

# ---- OS updates and reboot ---------------------------------------------------
if [ -f /var/run/reboot-required ]; then
  add_check os-updates "OS updates" warn "Reboot needed" "$(head -c 120 /var/run/reboot-required.pkgs 2>/dev/null | paste -sd ' ')" \
    "$(date -Iseconds -r /var/run/reboot-required)"
elif command -v apt-get >/dev/null; then
  pending=$(apt-get -s upgrade 2>/dev/null | grep -c '^Inst ' || true)
  sec=$(apt-get -s upgrade 2>/dev/null | grep '^Inst ' | grep -ci security || true)
  if [ "${sec:-0}" -gt 0 ]; then add_check os-updates "OS updates" warn "$sec security" "$pending pending"
  else add_check os-updates "OS updates" ok "Up to date" "${pending:-0} pending"; fi
fi

# ---- Raspberry Pi: undervoltage / throttling ---------------------------------
if command -v vcgencmd >/dev/null; then
  t=$(vcgencmd get_throttled | cut -d= -f2)
  if [ "$t" = "0x0" ]; then add_check throttling "Undervoltage / throttling" ok "None" "since boot"
  else add_check throttling "Undervoltage / throttling" warn "Flags $t" "since boot (see vcgencmd get_throttled)"; fi
fi

# ---- restic (written by the backup job) --------------------------------------
backup_check() { # file id name maxHours
  local f="$1"
  [ -r "$f" ] || return 0
  local ok at detail age level result
  ok=$(jq -r '.ok' "$f"); at=$(jq -r '.at' "$f"); detail=$(jq -r '.added // .detail // ""' "$f")
  age=$(( ( $(date +%s) - $(date -d "$at" +%s) ) / 3600 ))
  if [ "$ok" != "true" ]; then level=bad; result=Failed
  elif [ "$age" -gt "$4" ]; then level=bad; result="Late (${age} h)"
  else level=ok; result=OK; fi
  add_check "$2" "$3" "$level" "$result" "$detail" "$at"
}
backup_check "${RESTIC_STATUS:-/var/lib/restic/last.json}" restic-backup "restic backup" 26
backup_check "${RESTIC_CHECK_STATUS:-/var/lib/restic/check.json}" restic-check "restic repository check" 192

# ---- HTTPS certificate -------------------------------------------------------
if [ -n "${CERT_HOST:-}" ] && command -v openssl >/dev/null; then
  end=$(echo | timeout 5 openssl s_client -connect "$CERT_HOST:443" -servername "$CERT_HOST" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "$end" ]; then
    days=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
    if [ "$days" -lt 7 ]; then add_check tls-cert "HTTPS certificate" bad "Expiring" "in $days d"
    elif [ "$days" -lt 20 ]; then add_check tls-cert "HTTPS certificate" warn "Renew soon" "in $days d"
    else add_check tls-cert "HTTPS certificate" ok "Valid" "expires in $days d"; fi
  fi
fi

# ---- Write -------------------------------------------------------------------
jq -n --arg host "$(hostname)" --arg at "$NOW" \
  --argjson cpu "$cpu" --argjson memUsed "$((mem_total - mem_avail))" --argjson memTotal "$mem_total" \
  --argjson temp "$temp" --argjson uptime "$uptime_s" --argjson hist "$cpu_history" \
  --argjson disks "$disks" --argjson checks "$checks" \
  '{host:$host, generatedAt:$at,
    stats:{cpu:$cpu, ram:{used:$memUsed,total:$memTotal}, temp:$temp, uptime:$uptime, cpuHistory:$hist},
    disks:$disks, checks:$checks}' > "$TMP"
chmod 644 "$TMP"
mv "$TMP" "$OUT"
