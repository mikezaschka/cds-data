#!/usr/bin/env bash
# Pipeline Console dev backend — multiple pipelines on :4100.
# Pair with: npm run dev:pipeline-console (from packages/cds-data-pipeline).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PROVIDERS="$PKG_ROOT/examples/_providers"

EXAMPLE_PORT=4100
LOGISTICS_PORT=4455
FX_PORT=4456

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "[dev-console] Installing dependencies..."
    (cd "$SCRIPT_DIR" && npm install --no-audit --no-fund)
fi

pids=()
cleanup() {
    echo ""
    echo "[dev-console] Stopping..."
    for pid in "${pids[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
    exit 0
}
trap cleanup INT TERM

for port in $EXAMPLE_PORT $LOGISTICS_PORT $FX_PORT; do
    pid=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo "[dev-console] Port $port busy (pid $pid) — killing"
        kill -9 "$pid" 2>/dev/null || true
    fi
done

prefix() { sed -u "s/^/[dev-console:$1] /"; }

echo "[dev-console] Starting LogisticsService on :$LOGISTICS_PORT (1000 shipments) ..."
(cd "$PROVIDERS/logistics-service" && LOGISTICS_SHIPMENT_COUNT=1000 npx cds-serve --port $LOGISTICS_PORT 2>&1 | prefix logistics) &
pids+=($!)

echo "[dev-console] Starting FXService on :$FX_PORT ..."
(cd "$PROVIDERS/fx-service" && PORT=$FX_PORT node server.js 2>&1 | prefix fx) &
pids+=($!)

sleep 2

echo "[dev-console] Starting dev backend on :$EXAMPLE_PORT ..."
(cd "$SCRIPT_DIR" && npx cds-serve --port $EXAMPLE_PORT 2>&1 | prefix backend) &
pids+=($!)

sleep 2

echo ""
echo "[dev-console] Ready."
echo "  Management API: http://localhost:$EXAMPLE_PORT/pipeline/Pipelines"
echo "  Dev OData:      http://localhost:$EXAMPLE_PORT/odata/v4/dev/Shipments"
echo "  Archive OData:  http://localhost:$EXAMPLE_PORT/odata/v4/archive/ShipmentArchive"
echo "  Reporting API:  http://localhost:$EXAMPLE_PORT/reporting/CarrierFacts"
echo ""
echo "[dev-console] Ctrl+C to stop."

wait
