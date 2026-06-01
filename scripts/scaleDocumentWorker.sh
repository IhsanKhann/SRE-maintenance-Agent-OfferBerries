#!/usr/bin/env bash
# Adjusts BullMQ document worker concurrency via Redis.
# Reads: SRE_PARAMS JSON with { "concurrency": 3 }
set -euo pipefail

CONCURRENCY=$(echo "$SRE_PARAMS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('concurrency',3))")
REDIS_URL="${PROD_REDIS_URL:-redis://localhost:6379}"

if [[ "$CONCURRENCY" -lt 1 ]] || [[ "$CONCURRENCY" -gt 10 ]]; then
  echo "ERROR: concurrency must be 1–10"
  exit 1
fi

echo "[DocumentWorker] Setting concurrency to ${CONCURRENCY}"
redis-cli -u "$REDIS_URL" SET "sre:documentWorker:concurrency" "$CONCURRENCY"
echo "[DocumentWorker] Concurrency updated. Worker will pick this up on next job fetch."
echo "[DocumentWorker] Current queue state:"
redis-cli -u "$REDIS_URL" LLEN "bull:documentWorker:wait"
