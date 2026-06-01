#!/usr/bin/env bash
# Weekly backup verification — restores yesterday's backup and checks data integrity.
set -euo pipefail

YESTERDAY=$(date -d yesterday +%Y%m%d 2>/dev/null || date -v-1d +%Y%m%d 2>/dev/null || echo "")
echo "[Verify] Verifying backup from ${YESTERDAY}..."

if [[ -n "${HETZNER_S3_ACCESS_KEY:-}" ]]; then
  ARCHIVE="/tmp/verify_backup_${YESTERDAY}.tar.gz"
  AWS_ACCESS_KEY_ID="$HETZNER_S3_ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$HETZNER_S3_SECRET_KEY" \
  aws s3 cp \
    "s3://${BACKUP_S3_BUCKET:-offerberries-backups}/mongodb/${YESTERDAY}*/backup.tar.gz" \
    "$ARCHIVE" \
    --endpoint-url="${HETZNER_S3_ENDPOINT}" --region=us-east-1
else
  # Dev mode: use most recent local backup
  ARCHIVE=$(ls -t /tmp/sre_backups/backup_*.tar.gz 2>/dev/null | head -1)
  if [[ -z "$ARCHIVE" ]]; then
    echo "BACKUP_VERIFY_SKIP: No local backup found (dev mode)"
    exit 0
  fi
fi

tar -xzf "$ARCHIVE" -C /tmp/

TEST_URI="${MONGODB_TEST_URI:-mongodb://localhost:27017/sre_verify_test}"
echo "[Verify] Restoring to test URI..."
mongorestore --uri="$TEST_URI" --gzip /tmp/mongodump_*/ --drop > /dev/null 2>&1

echo "[Verify] Checking data integrity..."
COUNT=$(mongosh "$TEST_URI" --eval 'db.employees.countDocuments()' --quiet 2>/dev/null || echo "0")
TRANS_COUNT=$(mongosh "$TEST_URI" --eval 'db.transactions.countDocuments()' --quiet 2>/dev/null || echo "0")

if [[ "$COUNT" -lt 1 ]]; then
  echo "BACKUP_VERIFY_FAILED: Employee count is ${COUNT}"
  mongosh "$TEST_URI" --eval 'db.dropDatabase()' --quiet > /dev/null 2>&1 || true
  exit 1
fi

echo "BACKUP_VERIFY_OK: employees=${COUNT} transactions=${TRANS_COUNT}"
mongosh "$TEST_URI" --eval 'db.dropDatabase()' --quiet > /dev/null 2>&1 || true
rm -f "$ARCHIVE"
echo "[Verify] Backup verified successfully."
