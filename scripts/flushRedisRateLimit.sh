#!/usr/bin/env bash
# Flushes Redis rate-limit keys for a specific IP or all keys.
# Reads: SRE_PARAMS JSON with { "targetIp": "1.2.3.4" | "*" }
set -euo pipefail

TARGET_IP=$(echo "$SRE_PARAMS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('targetIp',''))")
REDIS_URL="${PROD_REDIS_URL:-redis://localhost:6379}"

if [[ -z "$TARGET_IP" ]]; then
  echo "ERROR: targetIp is required"
  exit 1
fi

if [[ "$TARGET_IP" == "*" ]]; then
  echo "[RateLimit] Flushing ALL rate-limit keys (pattern: rl:*)"
  COUNT=$(redis-cli -u "$REDIS_URL" KEYS "rl:*" | wc -l)
  redis-cli -u "$REDIS_URL" KEYS "rl:*" | xargs redis-cli -u "$REDIS_URL" DEL > /dev/null 2>&1 || true
  echo "[RateLimit] Cleared ${COUNT} rate-limit keys."
else
  PATTERN="rl:${TARGET_IP}*"
  echo "[RateLimit] Flushing keys for IP: ${TARGET_IP} (pattern: ${PATTERN})"
  COUNT=$(redis-cli -u "$REDIS_URL" KEYS "$PATTERN" | wc -l)
  redis-cli -u "$REDIS_URL" KEYS "$PATTERN" | xargs redis-cli -u "$REDIS_URL" DEL > /dev/null 2>&1 || true
  echo "[RateLimit] Cleared ${COUNT} keys for ${TARGET_IP}."
fi

echo "[RateLimit] Done."
