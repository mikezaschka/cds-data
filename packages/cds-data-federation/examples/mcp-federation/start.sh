#!/usr/bin/env bash
# Federation + MCP example — provider (OData) + consumer (@mcp + @federation.*).
# Ctrl+C stops both processes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FEDERATION_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROVIDER_DIR="$FEDERATION_ROOT/test/fixtures/provider"
CONSUMER_DIR="$SCRIPT_DIR/consumer"

PROVIDER_PORT=4121
CONSUMER_PORT=4120

if [ ! -d "$FEDERATION_ROOT/../../node_modules/@cap-js/mcp" ]; then
  echo "[mcp-federation] Installing workspace dependencies from repo root..."
  (cd "$FEDERATION_ROOT/../.." && npm install --legacy-peer-deps --no-audit --no-fund)
fi

pids=()
cleanup() {
  echo ""
  echo "[mcp-federation] Stopping..."
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

for port in $PROVIDER_PORT $CONSUMER_PORT; do
  pid=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "[mcp-federation] Port $port busy (pid $pid) — killing"
    kill -9 "$pid" 2>/dev/null || true
  fi
done

prefix() { sed -u "s/^/[${1}] /"; }

echo "[mcp-federation] Starting ProviderService on :$PROVIDER_PORT ..."
(
  cd "$PROVIDER_DIR"
  npx cds-serve --port "$PROVIDER_PORT" 2>&1 | prefix provider
) &
pids+=($!)

sleep 2

echo "[mcp-federation] Starting consumer (federation + MCP) on :$CONSUMER_PORT ..."
(
  cd "$CONSUMER_DIR"
  npx cds-serve --port "$CONSUMER_PORT" 2>&1 | prefix consumer
) &
pids+=($!)

sleep 4

echo ""
echo "[mcp-federation] Ready."
echo "  MCP endpoint:     http://localhost:$CONSUMER_PORT/mcp/agent"
echo "  OData (compare):  http://localhost:$CONSUMER_PORT/odata/v4/federation-agent/Customers"
echo "  Launchpad:        http://localhost:$CONSUMER_PORT/launchpage.html"
echo "  Pipeline Console: http://localhost:$CONSUMER_PORT/pipeline-console/"
echo "  Provider OData:   http://localhost:$PROVIDER_PORT/odata/v4/provider/Customers"
echo ""
echo "  Smoke test:       node scripts/mcp-smoke.mjs"
echo "  MCP Inspector:    npx @modelcontextprotocol/inspector  → URL above, Streamable HTTP"
echo ""
echo "[mcp-federation] Ctrl+C to stop."

wait
