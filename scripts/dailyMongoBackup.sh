#!/usr/bin/env bash
# Daily MongoDB backup to Hetzner Object Storage (S3-compatible).
# In dev mode (no S3 keys), backs up locally.
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/tmp/mongodump_${TIMESTAMP}"
ARCHIVE="/tmp/backup_${TIMESTAMP}.tar.gz"

echo "[Backup] Starting mongodump at ${TIMESTAMP}..."
mongodump --uri="${MONGODB_URI:-${MONGODB_SRE_URI:-mongodb://localhost:27017}}" \
  --out="$BACKUP_DIR" \
  --gzip \
  --excludeCollection=telemetry_snapshots  # exclude high-volume ephemeral data

echo "[Backup] Compressing archive..."
tar -czf "$ARCHIVE" -C /tmp "mongodump_${TIMESTAMP}"

if [[ -n "${HETZNER_S3_ACCESS_KEY:-}" ]]; then
  echo "[Backup] Uploading to Hetzner Object Storage..."
  AWS_ACCESS_KEY_ID="$HETZNER_S3_ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$HETZNER_S3_SECRET_KEY" \
  aws s3 cp "$ARCHIVE" \
    "s3://${BACKUP_S3_BUCKET:-offerberries-backups}/mongodb/${TIMESTAMP}/backup.tar.gz" \
    --endpoint-url="${HETZNER_S3_ENDPOINT}" \
    --region=us-east-1

  # Delete backups older than 30 days
  CUTOFF=$(date -d "30 days ago" +%Y%m%d 2>/dev/null || date -v-30d +%Y%m%d 2>/dev/null || echo "00000000")
  AWS_ACCESS_KEY_ID="$HETZNER_S3_ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$HETZNER_S3_SECRET_KEY" \
  aws s3 ls "s3://${BACKUP_S3_BUCKET:-offerberries-backups}/mongodb/" \
    --endpoint-url="${HETZNER_S3_ENDPOINT}" \
    --region=us-east-1 \
    | awk '{print $2}' \
    | while read -r dir; do
        backup_date=$(echo "$dir" | cut -c1-8)
        if [[ "$backup_date" < "$CUTOFF" ]]; then
          AWS_ACCESS_KEY_ID="$HETZNER_S3_ACCESS_KEY" \
          AWS_SECRET_ACCESS_KEY="$HETZNER_S3_SECRET_KEY" \
          aws s3 rm "s3://${BACKUP_S3_BUCKET:-offerberries-backups}/mongodb/${dir}" \
            --recursive --endpoint-url="${HETZNER_S3_ENDPOINT}" --region=us-east-1
        fi
      done

  echo "[Backup] Upload complete."
else
  # Dev mode — keep local backup in /tmp/sre_backups/
  mkdir -p /tmp/sre_backups
  cp "$ARCHIVE" "/tmp/sre_backups/backup_${TIMESTAMP}.tar.gz"
  echo "[Backup] Dev mode: saved locally at /tmp/sre_backups/backup_${TIMESTAMP}.tar.gz"
fi

# Cleanup temp files
rm -rf "$BACKUP_DIR" "$ARCHIVE"
echo "[Backup] Complete: ${TIMESTAMP}"
echo "BACKUP_SIZE=$(stat -c%s /tmp/sre_backups/backup_${TIMESTAMP}.tar.gz 2>/dev/null || echo 'uploaded')"
