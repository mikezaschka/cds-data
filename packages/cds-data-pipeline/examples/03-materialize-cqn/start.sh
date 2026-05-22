#!/usr/bin/env bash
# Launch example 03 — in-process SalesService + aggregate pipelines.
# No external providers needed; everything runs inside the example CAP app.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

EXAMPLE_PORT=4103

# Pipeline UIs: examples/_ui-pipeline/ + cds-plugin-ui5 (see package.json).

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "[example-03] Installing dependencies..."
    (cd "$SCRIPT_DIR" && npm install --no-audit --no-fund)
fi

pid=$(lsof -ti:$EXAMPLE_PORT 2>/dev/null || true)
[ -n "$pid" ] && { echo "[example-03] Port $EXAMPLE_PORT busy (pid $pid) — killing"; kill -9 "$pid" 2>/dev/null || true; }

echo "[example-03] Starting on :$EXAMPLE_PORT ..."
echo "  SalesService:     http://localhost:$EXAMPLE_PORT/odata/v4/sales/Orders"
echo "  ReportingService: http://localhost:$EXAMPLE_PORT/odata/v4/reporting/DailyCustomerRevenue"
echo "  Launchpad:        http://localhost:$EXAMPLE_PORT/launchpage.html  (cds-plugin-ui5: /pipeline-monitor, /pipeline-console)"
echo ""

cd "$SCRIPT_DIR"
exec npx cds-serve --port $EXAMPLE_PORT
