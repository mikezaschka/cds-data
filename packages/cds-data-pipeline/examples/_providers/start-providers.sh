#!/usr/bin/env bash
# Boot the shared example backends used by the numbered examples under
# `examples/`. Ctrl+C stops everything.
#
# Ports:
#   4455  LogisticsService (default / DEV origin for examples 01-04, 06)
#   4465  LogisticsService second instance (PROD origin for example 05)
#   4456  FXService (REST, used by example 02)
#
# Toggle the second logistics instance by setting LOGISTICS_PROD=1 before
# calling this script. Example 05's start.sh enables it; the others don't
# need it.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LOGISTICS_PORT=4455
LOGISTICS_PROD_PORT=4465
FX_PORT=4456

pids=()

cleanup() {
    echo ""
    echo "[providers] Stopping..."
    for pid in "${pids[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
    exit 0
}
trap cleanup INT TERM

ports=($LOGISTICS_PORT $FX_PORT)
[ "${LOGISTICS_PROD:-0}" = "1" ] && ports+=($LOGISTICS_PROD_PORT)

for port in "${ports[@]}"; do
    pid=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo "[providers] Port $port busy (pid $pid) — killing"
        kill -9 "$pid" 2>/dev/null || true
    fi
done

prefix() { sed -u "s/^/[$1] /"; }

echo "[providers] Starting LogisticsService (DEV) on :$LOGISTICS_PORT ..."
(cd "$SCRIPT_DIR/logistics-service" && LOGISTICS_ORIGIN=DEV npx cds-serve --port $LOGISTICS_PORT 2>&1 | prefix logistics-dev) &
pids+=($!)

if [ "${LOGISTICS_PROD:-0}" = "1" ]; then
    echo "[providers] Starting LogisticsService (PROD) on :$LOGISTICS_PROD_PORT ..."
    (cd "$SCRIPT_DIR/logistics-service" && LOGISTICS_ORIGIN=PROD npx cds-serve --port $LOGISTICS_PROD_PORT 2>&1 | prefix logistics-prod) &
    pids+=($!)
fi

echo "[providers] Starting FXService on :$FX_PORT ..."
(cd "$SCRIPT_DIR/fx-service" && PORT=$FX_PORT node server.js 2>&1 | prefix fx) &
pids+=($!)

sleep 2

echo ""
echo "[providers] Ready."
echo "  LogisticsService (DEV):  http://localhost:$LOGISTICS_PORT/odata/v4/logistics/"
[ "${LOGISTICS_PROD:-0}" = "1" ] && echo "  LogisticsService (PROD): http://localhost:$LOGISTICS_PROD_PORT/odata/v4/logistics/"
echo "  FXService:               http://localhost:$FX_PORT/api/rates"
echo ""
echo "[providers] Ctrl+C to stop."

wait
