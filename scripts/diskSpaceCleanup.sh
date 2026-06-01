#!/usr/bin/env bash
# Checks disk space and performs cleanup if above threshold.
set -euo pipefail

THRESHOLD="${DISK_THRESHOLD:-85}"
USAGE=$(df / | awk 'NR==2 {print $5}' | tr -d '%')

echo "[Disk] Current usage: ${USAGE}%"

if [[ "$USAGE" -gt "$THRESHOLD" ]]; then
  echo "DISK_ALERT: ${USAGE}% usage exceeds ${THRESHOLD}% threshold"
  echo "[Disk] Starting cleanup..."

  # Clean Docker
  docker system prune -f > /dev/null 2>&1 || true
  echo "[Disk] Docker system pruned."

  # Clean journald logs older than 7 days
  journalctl --vacuum-time=7d 2>/dev/null || true

  # Clean /tmp files older than 3 days
  find /tmp -mtime +3 -delete 2>/dev/null || true

  NEW_USAGE=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
  echo "[Disk] After cleanup: ${NEW_USAGE}%"

  if [[ "$NEW_USAGE" -gt "$THRESHOLD" ]]; then
    echo "DISK_CRITICAL: Still at ${NEW_USAGE}% after cleanup — manual intervention needed"
  fi
else
  echo "[Disk] OK — no cleanup needed."
fi
