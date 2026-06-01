#!/usr/bin/env bash
# Restarts a named Docker container gracefully.
# Reads: SRE_PARAMS JSON with { "containerName": "backend" }
set -euo pipefail

CONTAINER_NAME=$(echo "$SRE_PARAMS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('containerName',''))")

if [[ -z "$CONTAINER_NAME" ]]; then
  echo "ERROR: containerName is required"
  exit 1
fi

# Hard allowlist — refuse to restart any container not on this list
ALLOWED=("backend" "OfferBerries_backend" "OfferBerries_nginx" "nginx_prod")
ALLOWED_STR="${ALLOWED[*]}"
if [[ ! " ${ALLOWED_STR} " =~ " ${CONTAINER_NAME} " ]]; then
  echo "ERROR: Container '${CONTAINER_NAME}' is not in the restart allowlist"
  exit 1
fi

echo "[Restart] Checking container status: ${CONTAINER_NAME}"
STATUS=$(docker inspect --format '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null || echo "not_found")

if [[ "$STATUS" == "not_found" ]]; then
  echo "ERROR: Container '${CONTAINER_NAME}' not found"
  exit 1
fi

echo "[Restart] Current status: ${STATUS}"
echo "[Restart] Sending SIGTERM to ${CONTAINER_NAME}..."
docker restart --time 10 "${CONTAINER_NAME}"

# Wait for container to be running with health OK
ATTEMPTS=0
until docker inspect --format '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null | grep -q "running"; do
  ATTEMPTS=$((ATTEMPTS+1))
  if [[ $ATTEMPTS -ge 30 ]]; then
    echo "ERROR: Container did not recover within 30s"
    exit 1
  fi
  sleep 1
done

echo "[Restart] Container ${CONTAINER_NAME} is running."

# Extra health check if it's the backend
if [[ "$CONTAINER_NAME" == *"backend"* ]]; then
  echo "[Restart] Waiting for /api/health..."
  HEALTH_ATTEMPTS=0
  until curl -sf "http://localhost:5000/api/health" | grep -q '"status":"ok"'; do
    HEALTH_ATTEMPTS=$((HEALTH_ATTEMPTS+1))
    if [[ $HEALTH_ATTEMPTS -ge 20 ]]; then
      echo "WARNING: /api/health did not return ok within 20s — container running but may not be ready"
      exit 0
    fi
    sleep 2
  done
  echo "[Restart] Backend health check PASSED."
fi

echo "[Restart] Done: ${CONTAINER_NAME} successfully restarted."
