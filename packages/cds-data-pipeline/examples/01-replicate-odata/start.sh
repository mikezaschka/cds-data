#!/usr/bin/env bash
# Launch example 01 — LogisticsService provider + example consumer.
# Ctrl+C stops everything.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

EXAMPLE_PORT=4101
LOGISTICS_PORT=4455

# Shared UI5 apps live in examples/_ui-pipeline/ and are linked via package.json (file: deps);
# cds-plugin-ui5 mounts them at /pipeline-monitor and /pipeline-console. app/launchpage.html
# points at the shared sandbox (symlink).

# Ensure dependencies are present.
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "[example-01] Installing dependencies..."
    (cd "$SCRIPT_DIR" && npm install --no-audit --no-fund)
fi

pids=()
cleanup() {
    echo ""
    echo "[example-01] Stopping..."
    for pid in "${pids[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
    exit 0
}
trap cleanup INT TERM

for port in $EXAMPLE_PORT $LOGISTICS_PORT; do
    pid=$(lsof -ti:$port 2>/dev/null || true)
    [ -n "$pid" ] && { echo "[example-01] Port $port busy (pid $pid) — killing"; kill -9 "$pid" 2>/dev/null || true; }
done

prefix() { sed -u "s/^/[$1] /"; }

echo "[example-01] Starting LogisticsService on :$LOGISTICS_PORT ..."
(cd "$REPO_ROOT/examples/_providers/logistics-service" && npx cds-serve --port $LOGISTICS_PORT 2>&1 | prefix logistics) &
pids+=($!)

sleep 2

echo "[example-01] Starting consumer on :$EXAMPLE_PORT ..."
(cd "$SCRIPT_DIR" && npx cds-serve --port $EXAMPLE_PORT 2>&1 | prefix example-01) &
pids+=($!)

echo ""
echo "[example-01] Ready."
echo "  OData:            http://localhost:$EXAMPLE_PORT/odata/v4/example/Shipments"
echo "  Launchpad:        http://localhost:$EXAMPLE_PORT/launchpage.html"
echo "  (tiles: /pipeline-monitor, /pipeline-console via cds-plugin-ui5)"
echo "  Management API:   http://localhost:$EXAMPLE_PORT/pipeline/Pipelines"
echo ""
echo "[example-01] Scenarios in examples/01-replicate-odata/http/ — Ctrl+C to stop."

wait
