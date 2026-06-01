#!/usr/bin/env bash
# Rolls back to the previous Docker image tag stored in Redis.
set -euo pipefail

REDIS_URL="${PROD_REDIS_URL:-redis://localhost:6379}"
PREV_TAG=$(redis-cli -u "$REDIS_URL" GET "sre:deploy:previous_tag" 2>/dev/null || echo "")
REGISTRY="${DOCKER_REGISTRY:-ghcr.io/ihsan}"
OLD_CONTAINER="OfferBerries_backend"
NGINX_CONTAINER="${NGINX_CONTAINER:-OfferBerries_nginx}"

if [[ -z "$PREV_TAG" ]]; then
  echo "ERROR: No previous tag stored in Redis (sre:deploy:previous_tag)"
  exit 1
fi

echo "[Rollback] Rolling back to: ${PREV_TAG}"
ROLLBACK_IMAGE="${REGISTRY}/offerberries-backend:${PREV_TAG}"

echo "[Rollback] Pulling rollback image..."
docker pull "$ROLLBACK_IMAGE"

docker run -d \
  --name "backend_rollback" \
  --network mern_network \
  --env-file /opt/offerberries/backend/.env.production \
  -p "5001:5000" \
  "$ROLLBACK_IMAGE"

echo "[Rollback] Waiting for rollback health check..."
ATTEMPTS=0
until curl -sf "http://localhost:5001/api/health" 2>/dev/null | python3 -c "import sys,json; sys.exit(0 if json.load(sys.stdin).get('status')=='ok' else 1)"; do
  ATTEMPTS=$((ATTEMPTS+1))
  if [[ $ATTEMPTS -ge 12 ]]; then
    echo "ERROR: Rollback health check failed — system is in degraded state"
    docker rm -f backend_rollback 2>/dev/null || true
    exit 1
  fi
  sleep 5
done

docker exec "$NGINX_CONTAINER" sh -c "
  sed -i 's/server ${OLD_CONTAINER}:5000/server backend_rollback:5000/g' /etc/nginx/conf.d/default.conf && \
  nginx -s reload
"

docker stop "$OLD_CONTAINER" 2>/dev/null || true
docker rm "$OLD_CONTAINER" 2>/dev/null || true
docker rename "backend_rollback" "$OLD_CONTAINER"

docker exec "$NGINX_CONTAINER" sh -c "
  sed -i 's/server backend_rollback:5000/server ${OLD_CONTAINER}:5000/g' /etc/nginx/conf.d/default.conf && \
  nginx -s reload
"

echo "[Rollback] Complete: now running ${PREV_TAG}"
