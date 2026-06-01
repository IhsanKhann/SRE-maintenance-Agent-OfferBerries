#!/usr/bin/env bash
# Tests and reloads Nginx config without dropping connections.
set -euo pipefail

NGINX_CONTAINER="${NGINX_CONTAINER:-OfferBerries_nginx}"

echo "[Nginx] Testing config..."
docker exec "$NGINX_CONTAINER" nginx -t
echo "[Nginx] Config OK. Reloading..."
docker exec "$NGINX_CONTAINER" nginx -s reload
echo "[Nginx] Reload complete — no connections dropped."
