#!/usr/bin/env bash
# Launch example 06 — LogisticsService provider + consumer with event hooks.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

EXAMPLE_PORT=4106
LOGISTICS_PORT=4455

# Pipeline UIs: examples/_ui-pipeline/ + cds-plugin-ui5 (see package.json).

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "[example-06] Installing dependencies..."
    (cd "$SCRIPT_DIR" && npm install --no-audit --no-fund)
fi

pids=()
cleanup() {
    echo ""
    echo "[example-06] Stopping..."
    for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
    wait 2>/dev/null || true
    exit 0
}
trap cleanup INT TERM

for port in $EXAMPLE_PORT $LOGISTICS_PORT; do
    pid=$(lsof -ti:$port 2>/dev/null || true)
    [ -n "$pid" ] && { echo "[example-06] Port $port busy (pid $pid) — killing"; kill -9 "$pid" 2>/dev/null || true; }
done

prefix() { sed -u "s/^/[$1] /"; }

echo "[example-06] Starting LogisticsService on :$LOGISTICS_PORT ..."
(cd "$REPO_ROOT/examples/_providers/logistics-service" && npx cds-serve --port $LOGISTICS_PORT 2>&1 | prefix logistics) &
pids+=($!)

sleep 2

echo "[example-06] Starting consumer on :$EXAMPLE_PORT (watch for [START]/[MAP]/[WRITE]/[DONE] lines) ..."
(cd "$SCRIPT_DIR" && npx cds-serve --port $EXAMPLE_PORT 2>&1 | prefix example-06) &
pids+=($!)

echo ""
echo "[example-06] Ready."
echo "  OData:    http://localhost:$EXAMPLE_PORT/odata/v4/example/Shipments"
echo "  Metrics:  http://localhost:$EXAMPLE_PORT/odata/v4/example/BatchMetrics"
echo "  Launchpad: http://localhost:$EXAMPLE_PORT/launchpage.html  (cds-plugin-ui5: /pipeline-monitor, /pipeline-console)"
echo ""

wait
