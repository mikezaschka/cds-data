#!/usr/bin/env bash
# Launch example 07 — LogisticsService provider + event-driven consumer.
# Ctrl+C stops everything.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

EXAMPLE_PORT=4107
LOGISTICS_PORT=4455

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "[example-07] Installing dependencies..."
    (cd "$SCRIPT_DIR" && npm install --no-audit --no-fund)
fi

if [ ! -d "$REPO_ROOT/examples/_providers/logistics-service/node_modules" ]; then
    echo "[example-07] Installing logistics-service dependencies..."
    (cd "$REPO_ROOT/examples/_providers/logistics-service" && npm install --no-audit --no-fund)
fi

pids=()
cleanup() {
    echo ""
    echo "[example-07] Stopping..."
    for pid in "${pids[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
    exit 0
}
trap cleanup INT TERM

for port in $EXAMPLE_PORT $LOGISTICS_PORT; do
    pid=$(lsof -ti:$port 2>/dev/null || true)
    [ -n "$pid" ] && { echo "[example-07] Port $port busy (pid $pid) — killing"; kill -9 "$pid" 2>/dev/null || true; }
done

prefix() { sed -u "s/^/[$1] /"; }

echo "[example-07] Starting LogisticsService on :$LOGISTICS_PORT ..."
(cd "$REPO_ROOT/examples/_providers/logistics-service" && CDS_ENV=development npx cds-serve --port $LOGISTICS_PORT 2>&1 | prefix logistics) &
pids+=($!)

sleep 2

echo "[example-07] Starting consumer on :$EXAMPLE_PORT ..."
(cd "$SCRIPT_DIR" && CDS_ENV=development npx cds-serve --port $EXAMPLE_PORT 2>&1 | prefix example-07) &
pids+=($!)

echo ""
echo "[example-07] Ready."
echo "  OData:            http://localhost:$EXAMPLE_PORT/odata/v4/example/Shipments"
echo "  Launchpad:        http://localhost:$EXAMPLE_PORT/launchpage.html"
echo "  Management API:   http://localhost:$EXAMPLE_PORT/pipeline/Pipelines"
echo "  Provider emit:    http://localhost:$LOGISTICS_PORT/odata/v4/logistics/emitShipmentKeyTest"
echo ""
echo "[example-07] Scenarios in examples/07-event-driven-runs/http/ — Ctrl+C to stop."

wait
