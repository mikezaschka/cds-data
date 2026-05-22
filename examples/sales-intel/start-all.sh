#!/usr/bin/env bash
# Start every server needed for the Sales Intelligence Workbench example.
# Ctrl+C kills them all.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LOGISTICS_PORT=4455
FX_PORT=4456
WORKBENCH_PORT=4005

pids=()

cleanup() {
    echo ""
    echo "[sales-intel] Stopping servers..."
    for pid in "${pids[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
    exit 0
}
trap cleanup INT TERM

for port in $LOGISTICS_PORT $FX_PORT $WORKBENCH_PORT; do
    pid=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo "[sales-intel] Port $port busy (pid $pid) — killing"
        kill -9 "$pid" 2>/dev/null || true
    fi
done

prefix() { sed -u "s/^/[$1] /"; }

echo "[sales-intel] Starting LogisticsService (bundled CAP) on :$LOGISTICS_PORT ..."
(cd "$SCRIPT_DIR/providers/logistics-service" && npx cds-serve --port $LOGISTICS_PORT 2>&1 | prefix logistics) &
pids+=($!)

echo "[sales-intel] Starting FXService (bundled REST) on :$FX_PORT ..."
(cd "$SCRIPT_DIR/providers/fx-service" && PORT=$FX_PORT node server.js 2>&1 | prefix fx) &
pids+=($!)

sleep 2

echo "[sales-intel] Starting Workbench on :$WORKBENCH_PORT ..."
(cd "$SCRIPT_DIR/workbench" && npx cds-serve --port $WORKBENCH_PORT 2>&1 | prefix workbench) &
pids+=($!)

echo ""
echo "[sales-intel] All servers starting."
echo "  Workbench OData:      http://localhost:$WORKBENCH_PORT/odata/v4/sales-intel/"
echo "  Federation Monitor:   http://localhost:$WORKBENCH_PORT/pipeline/Pipelines"
echo "  LogisticsService:     http://localhost:$LOGISTICS_PORT/odata/v4/logistics/"
echo "  FXService:            http://localhost:$FX_PORT/api/rates"
echo ""
echo "[sales-intel] .http scenarios: examples/sales-intel/workbench/http/"
echo "[sales-intel] Ctrl+C to stop everything."

wait
