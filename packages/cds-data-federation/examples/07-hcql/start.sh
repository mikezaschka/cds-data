#!/usr/bin/env bash
# 07-hcql — @hcql provider + consumer delegate (CAP auto-selects HCQL).
# Requires CDS 10 for HCQL. Ctrl+C stops both processes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FEDERATION_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROVIDER_DIR="$FEDERATION_ROOT/test/fixtures/hcql-provider"
CONSUMER_DIR="$SCRIPT_DIR"

PROVIDER_PORT=4147
CONSUMER_PORT=4137

if [ ! -d "$FEDERATION_ROOT/../../node_modules/@sap/cds" ]; then
  echo "[07-hcql] Installing workspace dependencies from repo root..."
  (cd "$FEDERATION_ROOT/../.." && npm install --legacy-peer-deps --no-audit --no-fund)
fi

pids=()
cleanup() {
  echo ""
  echo "[07-hcql] Stopping..."
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

for port in $PROVIDER_PORT $CONSUMER_PORT; do
  pid=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "[07-hcql] Port $port busy (pid $pid) — killing"
    kill -9 "$pid" 2>/dev/null || true
  fi
done

prefix() { sed -u "s/^/[${1}] /"; }

echo "[07-hcql] Starting @hcql ProviderService on :$PROVIDER_PORT ..."
( cd "$PROVIDER_DIR" && npx cds-serve --port "$PROVIDER_PORT" 2>&1 | prefix provider ) &
pids+=($!)

sleep 2

echo "[07-hcql] Starting consumer on :$CONSUMER_PORT ..."
( cd "$CONSUMER_DIR" && npx cds-serve --port "$CONSUMER_PORT" 2>&1 | prefix consumer ) &
pids+=($!)

sleep 4

echo ""
echo "[07-hcql] Ready."
echo "  Flattened (HCQL only):  http://localhost:$CONSUMER_PORT/odata/v4/shop/OrderFlat"
echo "  Customers (delegate):   http://localhost:$CONSUMER_PORT/odata/v4/shop/Customers"
echo "  Provider (@hcql @odata):http://localhost:$PROVIDER_PORT/odata/v4/provider/Orders"
echo ""
echo "  Note: OrderFlat's customer.name / product.name path expressions require HCQL (CDS 10)."
echo "  See http/scenarios.http."
echo "[07-hcql] Ctrl+C to stop."

wait
