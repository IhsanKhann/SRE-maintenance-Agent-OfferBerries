#!/usr/bin/env bash
# Backs up Redis RDB snapshot.
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REDIS_URL="${PROD_REDIS_URL:-redis://localhost:6379}"

echo "[Redis Backup] Triggering BGSAVE..."
redis-cli -u "$REDIS_URL" BGSAVE
sleep 10

# Try to copy from Docker container
REDIS_CONTAINER="${REDIS_CONTAINER:-OfferBerries_redis}"
if docker inspect "$REDIS_CONTAINER" > /dev/null 2>&1; then
  docker cp "${REDIS_CONTAINER}:/data/dump.rdb" "/tmp/redis_dump_${TIMESTAMP}.rdb"
  echo "[Redis Backup] RDB file copied from container."
fi

if [[ -f "/tmp/redis_dump_${TIMESTAMP}.rdb" ]]; then
  if [[ -n "${HETZNER_S3_ACCESS_KEY:-}" ]]; then
    AWS_ACCESS_KEY_ID="$HETZNER_S3_ACCESS_KEY" \
    AWS_SECRET_ACCESS_KEY="$HETZNER_S3_SECRET_KEY" \
    aws s3 cp "/tmp/redis_dump_${TIMESTAMP}.rdb" \
      "s3://${BACKUP_S3_BUCKET:-offerberries-backups}/redis/dump_${TIMESTAMP}.rdb" \
      --endpoint-url="${HETZNER_S3_ENDPOINT}" --region=us-east-1
    echo "[Redis Backup] Uploaded to S3."
  else
    mkdir -p /tmp/sre_backups
    cp "/tmp/redis_dump_${TIMESTAMP}.rdb" "/tmp/sre_backups/"
    echo "[Redis Backup] Dev mode: saved locally."
  fi
  rm -f "/tmp/redis_dump_${TIMESTAMP}.rdb"
fi

echo "[Redis Backup] Done: ${TIMESTAMP}"
