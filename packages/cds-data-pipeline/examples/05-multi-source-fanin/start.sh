#!/usr/bin/env bash
# Launch example 05 — two LogisticsService instances (DEV / PROD) + consumer.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

EXAMPLE_PORT=4105
LOGISTICS_DEV_PORT=4455
LOGISTICS_PROD_PORT=4465

# Pipeline UIs: examples/_ui-pipeline/ + cds-plugin-ui5 (see package.json).

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "[example-05] Installing dependencies..."
    (cd "$SCRIPT_DIR" && npm install --no-audit --no-fund)
fi

pids=()
cleanup() {
    echo ""
    echo "[example-05] Stopping..."
    for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
    wait 2>/dev/null || true
    exit 0
}
trap cleanup INT TERM

for port in $EXAMPLE_PORT $LOGISTICS_DEV_PORT $LOGISTICS_PROD_PORT; do
    pid=$(lsof -ti:$port 2>/dev/null || true)
    [ -n "$pid" ] && { echo "[example-05] Port $port busy (pid $pid) — killing"; kill -9 "$pid" 2>/dev/null || true; }
done

prefix() { sed -u "s/^/[$1] /"; }

echo "[example-05] Starting LogisticsService DEV on :$LOGISTICS_DEV_PORT ..."
(cd "$REPO_ROOT/examples/_providers/logistics-service" && LOGISTICS_ORIGIN=DEV npx cds-serve --port $LOGISTICS_DEV_PORT 2>&1 | prefix logistics-dev) &
pids+=($!)

echo "[example-05] Starting LogisticsService PROD on :$LOGISTICS_PROD_PORT ..."
(cd "$REPO_ROOT/examples/_providers/logistics-service" && LOGISTICS_ORIGIN=PROD npx cds-serve --port $LOGISTICS_PROD_PORT 2>&1 | prefix logistics-prod) &
pids+=($!)

sleep 3

echo "[example-05] Starting consumer on :$EXAMPLE_PORT ..."
(cd "$SCRIPT_DIR" && npx cds-serve --port $EXAMPLE_PORT 2>&1 | prefix example-05) &
pids+=($!)

echo ""
echo "[example-05] Ready."
echo "  Local (consolidated): http://localhost:$EXAMPLE_PORT/odata/v4/example/Shipments"
echo "  DEV source direct:    http://localhost:$LOGISTICS_DEV_PORT/odata/v4/logistics/Shipments"
echo "  PROD source direct:   http://localhost:$LOGISTICS_PROD_PORT/odata/v4/logistics/Shipments"
echo "  Launchpad:            http://localhost:$EXAMPLE_PORT/launchpage.html  (cds-plugin-ui5: /pipeline-monitor, /pipeline-console)"
echo ""

wait
