#!/usr/bin/env bash
# Drains all failed jobs from a BullMQ queue.
# Reads: SRE_PARAMS JSON with { "queueName": "outboxRelay" | "documentWorker" }
set -euo pipefail

QUEUE_NAME=$(echo "$SRE_PARAMS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('queueName',''))")

ALLOWED=("outboxRelay" "documentWorker")
ALLOWED_STR="${ALLOWED[*]}"
if [[ ! " ${ALLOWED_STR} " =~ " ${QUEUE_NAME} " ]]; then
  echo "ERROR: Queue '${QUEUE_NAME}' is not in the allowlist"
  exit 1
fi

REDIS_URL="${PROD_REDIS_URL:-redis://localhost:6379}"
PREFIX="bull:${QUEUE_NAME}"

# Count before
FAILED_BEFORE=$(redis-cli -u "$REDIS_URL" ZCARD "${PREFIX}:failed" 2>/dev/null || echo 0)
echo "[BullMQ] Queue: ${QUEUE_NAME} | Failed jobs before: ${FAILED_BEFORE}"

if [[ "$FAILED_BEFORE" -eq 0 ]]; then
  echo "[BullMQ] No failed jobs to clear."
  exit 0
fi

# Delete all failed job keys and remove from the sorted set
# BullMQ v5 stores failed jobs in a ZSET: bull:{queueName}:failed
# Individual job data is at: bull:{queueName}:{jobId}
JOB_IDS=$(redis-cli -u "$REDIS_URL" ZRANGE "${PREFIX}:failed" 0 -1 2>/dev/null)
CLEARED=0

for JOB_ID in $JOB_IDS; do
  redis-cli -u "$REDIS_URL" DEL "${PREFIX}:${JOB_ID}" > /dev/null 2>&1 || true
  CLEARED=$((CLEARED+1))
done

redis-cli -u "$REDIS_URL" DEL "${PREFIX}:failed" > /dev/null 2>&1 || true

FAILED_AFTER=$(redis-cli -u "$REDIS_URL" ZCARD "${PREFIX}:failed" 2>/dev/null || echo 0)
echo "[BullMQ] Cleared ${CLEARED} failed jobs. Remaining: ${FAILED_AFTER}"
echo "[BullMQ] Done: ${QUEUE_NAME} dead-letter queue drained."
