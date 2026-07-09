#!/usr/bin/env bash
# 01-delegate — provider (OData V4) + consumer (@federation.delegate).
# Ctrl+C stops both processes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FEDERATION_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROVIDER_DIR="$FEDERATION_ROOT/test/fixtures/provider"
CONSUMER_DIR="$SCRIPT_DIR"

PROVIDER_PORT=4141
CONSUMER_PORT=4131

if [ ! -d "$FEDERATION_ROOT/../../node_modules/@sap/cds" ]; then
  echo "[01-delegate] Installing workspace dependencies from repo root..."
  (cd "$FEDERATION_ROOT/../.." && npm install --legacy-peer-deps --no-audit --no-fund)
fi

pids=()
cleanup() {
  echo ""
  echo "[01-delegate] Stopping..."
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

for port in $PROVIDER_PORT $CONSUMER_PORT; do
  pid=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "[01-delegate] Port $port busy (pid $pid) — killing"
    kill -9 "$pid" 2>/dev/null || true
  fi
done

prefix() { sed -u "s/^/[${1}] /"; }

echo "[01-delegate] Starting ProviderService on :$PROVIDER_PORT ..."
( cd "$PROVIDER_DIR" && npx cds-serve --port "$PROVIDER_PORT" 2>&1 | prefix provider ) &
pids+=($!)

sleep 2

echo "[01-delegate] Starting consumer on :$CONSUMER_PORT ..."
( cd "$CONSUMER_DIR" && npx cds-serve --port "$CONSUMER_PORT" 2>&1 | prefix consumer ) &
pids+=($!)

sleep 4

echo ""
echo "[01-delegate] Ready."
echo "  Customers (proxy):        http://localhost:$CONSUMER_PORT/odata/v4/shop/Customers"
echo "  Products (renamed):       http://localhost:$CONSUMER_PORT/odata/v4/shop/Products"
echo "  ActiveCustomers (where):  http://localhost:$CONSUMER_PORT/odata/v4/shop/ActiveCustomers"
echo "  Provider (upstream):      http://localhost:$PROVIDER_PORT/odata/v4/provider/Customers"
echo ""
echo "  Try the scenarios in http/ with the VS Code REST Client extension."
echo "[01-delegate] Ctrl+C to stop."

wait
