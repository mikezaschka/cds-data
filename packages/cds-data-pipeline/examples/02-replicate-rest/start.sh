#!/usr/bin/env bash
# Launch example 02 — FXService REST provider + example consumer.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

EXAMPLE_PORT=4102
FX_PORT=4456

# Pipeline UIs: examples/_ui-pipeline/ + cds-plugin-ui5 (see package.json).

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "[example-02] Installing dependencies..."
    (cd "$SCRIPT_DIR" && npm install --no-audit --no-fund)
fi

pids=()
cleanup() {
    echo ""
    echo "[example-02] Stopping..."
    for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
    wait 2>/dev/null || true
    exit 0
}
trap cleanup INT TERM

for port in $EXAMPLE_PORT $FX_PORT; do
    pid=$(lsof -ti:$port 2>/dev/null || true)
    [ -n "$pid" ] && { echo "[example-02] Port $port busy (pid $pid) — killing"; kill -9 "$pid" 2>/dev/null || true; }
done

prefix() { sed -u "s/^/[$1] /"; }

echo "[example-02] Starting FXService on :$FX_PORT ..."
(cd "$REPO_ROOT/examples/_providers/fx-service" && PORT=$FX_PORT node server.js 2>&1 | prefix fx) &
pids+=($!)

sleep 1

echo "[example-02] Starting consumer on :$EXAMPLE_PORT ..."
(cd "$SCRIPT_DIR" && npx cds-serve --port $EXAMPLE_PORT 2>&1 | prefix example-02) &
pids+=($!)

echo ""
echo "[example-02] Ready."
echo "  OData:            http://localhost:$EXAMPLE_PORT/odata/v4/example/ExchangeRates"
echo "  Launchpad:        http://localhost:$EXAMPLE_PORT/launchpage.html"
echo "  (tiles: /pipeline-monitor, /pipeline-console via cds-plugin-ui5)"
echo "  FXService direct: http://localhost:$FX_PORT/api/rates"
echo ""

wait
