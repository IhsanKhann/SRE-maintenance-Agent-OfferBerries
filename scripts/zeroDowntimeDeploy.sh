#!/usr/bin/env bash
# Zero-downtime blue-green deploy for OfferBerries backend.
# Reads: SRE_PARAMS JSON with { "imageTag": "sha-abc123" }
set -euo pipefail

IMAGE_TAG=$(echo "$SRE_PARAMS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('imageTag','latest'))")
REGISTRY="${DOCKER_REGISTRY:-ghcr.io/ihsan}"
NEW_IMAGE="${REGISTRY}/offerberries-backend:${IMAGE_TAG}"
NEW_CONTAINER="backend_blue"
OLD_CONTAINER="OfferBerries_backend"
HEALTH_PORT="5001"
NGINX_CONTAINER="${NGINX_CONTAINER:-OfferBerries_nginx}"

echo "[Deploy] Zero-downtime deploy: ${IMAGE_TAG}"
echo "[Deploy] New image: ${NEW_IMAGE}"

# Pull new image
docker pull "$NEW_IMAGE"

# Stop any previous failed blue container
docker rm -f "$NEW_CONTAINER" 2>/dev/null || true

echo "[Deploy] Starting new container on temp port ${HEALTH_PORT}..."
docker run -d \
  --name "$NEW_CONTAINER" \
  --network mern_network \
  --env-file /opt/offerberries/backend/.env.production \
  -p "${HEALTH_PORT}:5000" \
  "$NEW_IMAGE"

echo "[Deploy] Waiting for health check (60s timeout)..."
ATTEMPTS=0
until curl -sf "http://localhost:${HEALTH_PORT}/api/health" 2>/dev/null | python3 -c "import sys,json; data=json.load(sys.stdin); sys.exit(0 if data.get('status')=='ok' else 1)"; do
  ATTEMPTS=$((ATTEMPTS+1))
  if [[ $ATTEMPTS -ge 12 ]]; then
    echo "[Deploy] Health check failed — rolling back"
    docker rm -f "$NEW_CONTAINER" 2>/dev/null || true
    exit 1
  fi
  echo "[Deploy] Attempt ${ATTEMPTS}/12..."
  sleep 5
done

echo "[Deploy] Health check PASSED — switching Nginx upstream..."
# Update nginx upstream to point to new container
docker exec "$NGINX_CONTAINER" sh -c "
  sed -i 's/server ${OLD_CONTAINER}:5000/server ${NEW_CONTAINER}:5000/g' /etc/nginx/conf.d/default.conf && \
  nginx -t && nginx -s reload
"

echo "[Deploy] Traffic switched to new container."

echo "[Deploy] Stopping old container..."
docker stop "$OLD_CONTAINER" 2>/dev/null || true
docker rm "$OLD_CONTAINER" 2>/dev/null || true

echo "[Deploy] Renaming new container to ${OLD_CONTAINER}..."
docker rename "$NEW_CONTAINER" "$OLD_CONTAINER"

# Restore nginx upstream name
docker exec "$NGINX_CONTAINER" sh -c "
  sed -i 's/server ${NEW_CONTAINER}:5000/server ${OLD_CONTAINER}:5000/g' /etc/nginx/conf.d/default.conf && \
  nginx -s reload
"

echo "[Deploy] Zero-downtime deploy complete: ${IMAGE_TAG}"
echo "DEPLOYED_TAG=${IMAGE_TAG}"
