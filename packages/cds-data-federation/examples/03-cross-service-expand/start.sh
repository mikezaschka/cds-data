#!/usr/bin/env bash
# 03-cross-service-expand — provider (OData V4) + consumer (local + remote entities).
# Ctrl+C stops both processes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FEDERATION_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROVIDER_DIR="$FEDERATION_ROOT/test/fixtures/provider"
CONSUMER_DIR="$SCRIPT_DIR"

PROVIDER_PORT=4143
CONSUMER_PORT=4133

if [ ! -d "$FEDERATION_ROOT/../../node_modules/@sap/cds" ]; then
  echo "[03-expand] Installing workspace dependencies from repo root..."
  (cd "$FEDERATION_ROOT/../.." && npm install --legacy-peer-deps --no-audit --no-fund)
fi

pids=()
cleanup() {
  echo ""
  echo "[03-expand] Stopping..."
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

for port in $PROVIDER_PORT $CONSUMER_PORT; do
  pid=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "[03-expand] Port $port busy (pid $pid) — killing"
    kill -9 "$pid" 2>/dev/null || true
  fi
done

prefix() { sed -u "s/^/[${1}] /"; }

echo "[03-expand] Starting ProviderService on :$PROVIDER_PORT ..."
( cd "$PROVIDER_DIR" && npx cds-serve --port "$PROVIDER_PORT" 2>&1 | prefix provider ) &
pids+=($!)

sleep 2

echo "[03-expand] Starting consumer on :$CONSUMER_PORT ..."
( cd "$CONSUMER_DIR" && npx cds-serve --port "$CONSUMER_PORT" 2>&1 | prefix consumer ) &
pids+=($!)

sleep 4

echo ""
echo "[03-expand] Ready."
echo "  local → remote:   http://localhost:$CONSUMER_PORT/odata/v4/shop/Reviews?\$expand=product"
echo "  remote → local:   http://localhost:$CONSUMER_PORT/odata/v4/shop/Customers?\$expand=bookmarks"
echo "  navigation:       http://localhost:$CONSUMER_PORT/odata/v4/shop/Reviews?\$filter=product/category eq 'Electronics'"
echo ""
echo "  See http/scenarios.http for all cases."
echo "[03-expand] Ctrl+C to stop."

wait
