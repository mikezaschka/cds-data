#!/usr/bin/env bash
# 05-cross-provider-mashup — two providers (V4) + consumer joining both.
# Ctrl+C stops all processes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FEDERATION_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROVIDER_DIR="$FEDERATION_ROOT/test/fixtures/provider"
INVENTORY_DIR="$FEDERATION_ROOT/test/fixtures/inventory"
CONSUMER_DIR="$SCRIPT_DIR"

PROVIDER_PORT=4145
INVENTORY_PORT=4155
CONSUMER_PORT=4135

if [ ! -d "$FEDERATION_ROOT/../../node_modules/@sap/cds" ]; then
  echo "[05-mashup] Installing workspace dependencies from repo root..."
  (cd "$FEDERATION_ROOT/../.." && npm install --legacy-peer-deps --no-audit --no-fund)
fi

pids=()
cleanup() {
  echo ""
  echo "[05-mashup] Stopping..."
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

for port in $PROVIDER_PORT $INVENTORY_PORT $CONSUMER_PORT; do
  pid=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "[05-mashup] Port $port busy (pid $pid) — killing"
    kill -9 "$pid" 2>/dev/null || true
  fi
done

prefix() { sed -u "s/^/[${1}] /"; }

echo "[05-mashup] Starting ProviderService on :$PROVIDER_PORT ..."
( cd "$PROVIDER_DIR" && npx cds-serve --port "$PROVIDER_PORT" 2>&1 | prefix provider ) &
pids+=($!)

echo "[05-mashup] Starting InventoryService on :$INVENTORY_PORT ..."
( cd "$INVENTORY_DIR" && npx cds-serve --port "$INVENTORY_PORT" 2>&1 | prefix inventory ) &
pids+=($!)

sleep 3

echo "[05-mashup] Starting consumer on :$CONSUMER_PORT ..."
( cd "$CONSUMER_DIR" && npx cds-serve --port "$CONSUMER_PORT" 2>&1 | prefix consumer ) &
pids+=($!)

sleep 4

echo ""
echo "[05-mashup] Ready."
echo "  Cross-provider expand:"
echo "    http://localhost:$CONSUMER_PORT/odata/v4/shop/InventoryReports?\$expand=product,warehouse"
echo "  Provider A (products):  http://localhost:$PROVIDER_PORT/odata/v4/provider/Products"
echo "  Provider B (warehouses):http://localhost:$INVENTORY_PORT/odata/v4/inventory/Warehouses"
echo ""
echo "  See http/scenarios.http."
echo "[05-mashup] Ctrl+C to stop."

wait
