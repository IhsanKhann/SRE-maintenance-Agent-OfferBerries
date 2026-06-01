#!/usr/bin/env bash
# Cleans up Docker container logs and dangling images.
set -euo pipefail

echo "[Cleanup] Pruning Docker logs older than 7 days..."
# Truncate container log files older than 7 days to prevent disk fill
find /var/lib/docker/containers/ -name "*.log" -mtime +7 -exec truncate -s 0 {} \; 2>/dev/null || true

echo "[Cleanup] Removing dangling images..."
DANGLING=$(docker images -f "dangling=true" -q | wc -l)
if [[ "$DANGLING" -gt 0 ]]; then
  docker rmi $(docker images -f "dangling=true" -q) 2>/dev/null || true
  echo "[Cleanup] Removed ${DANGLING} dangling images."
else
  echo "[Cleanup] No dangling images."
fi

echo "[Cleanup] Removing stopped containers..."
docker container prune -f > /dev/null 2>&1 || true

echo "[Cleanup] Docker cleanup complete."
