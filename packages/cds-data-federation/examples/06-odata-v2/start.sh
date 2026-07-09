#!/usr/bin/env bash
# 06-odata-v2 — provider served as OData V2 (via cov2ap) + consumer delegate.
# Ctrl+C stops both processes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FEDERATION_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROVIDER_DIR="$FEDERATION_ROOT/test/fixtures/provider"
CONSUMER_DIR="$SCRIPT_DIR"

PROVIDER_PORT=4146
CONSUMER_PORT=4136

if [ ! -d "$FEDERATION_ROOT/../../node_modules/@sap/cds" ]; then
  echo "[06-v2] Installing workspace dependencies from repo root..."
  (cd "$FEDERATION_ROOT/../.." && npm install --legacy-peer-deps --no-audit --no-fund)
fi

pids=()
cleanup() {
  echo ""
  echo "[06-v2] Stopping..."
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

for port in $PROVIDER_PORT $CONSUMER_PORT; do
  pid=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "[06-v2] Port $port busy (pid $pid) — killing"
    kill -9 "$pid" 2>/dev/null || true
  fi
done

prefix() { sed -u "s/^/[${1}] /"; }

# The provider fixture bundles @cap-js-community/odata-v2-adapter, so it also
# serves an OData V2 endpoint at /odata/v2/provider alongside V4.
echo "[06-v2] Starting ProviderService (V4 + V2) on :$PROVIDER_PORT ..."
( cd "$PROVIDER_DIR" && npx cds-serve --port "$PROVIDER_PORT" 2>&1 | prefix provider ) &
pids+=($!)

sleep 3

echo "[06-v2] Starting consumer on :$CONSUMER_PORT ..."
( cd "$CONSUMER_DIR" && npx cds-serve --port "$CONSUMER_PORT" 2>&1 | prefix consumer ) &
pids+=($!)

sleep 4

echo ""
echo "[06-v2] Ready."
echo "  Consumer (delegate over V2): http://localhost:$CONSUMER_PORT/odata/v4/shop/Customers"
echo "  Provider V2 (upstream):      http://localhost:$PROVIDER_PORT/odata/v2/provider/Customers"
echo "  Provider V4 (same data):     http://localhost:$PROVIDER_PORT/odata/v4/provider/Customers"
echo ""
echo "  See http/scenarios.http."
echo "[06-v2] Ctrl+C to stop."

wait
