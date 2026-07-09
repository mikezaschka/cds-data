#!/usr/bin/env bash
# 02-replicate — provider (OData V4) + consumer (@federation.replicate + Pipeline Console).
# Ctrl+C stops both processes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FEDERATION_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROVIDER_DIR="$FEDERATION_ROOT/test/fixtures/provider"
CONSUMER_DIR="$SCRIPT_DIR"

PROVIDER_PORT=4142
CONSUMER_PORT=4132

if [ ! -d "$FEDERATION_ROOT/../../node_modules/@sap/cds" ]; then
  echo "[02-replicate] Installing workspace dependencies from repo root..."
  (cd "$FEDERATION_ROOT/../.." && npm install --legacy-peer-deps --no-audit --no-fund)
fi

pids=()
cleanup() {
  echo ""
  echo "[02-replicate] Stopping..."
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

for port in $PROVIDER_PORT $CONSUMER_PORT; do
  pid=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "[02-replicate] Port $port busy (pid $pid) — killing"
    kill -9 "$pid" 2>/dev/null || true
  fi
done

prefix() { sed -u "s/^/[${1}] /"; }

echo "[02-replicate] Starting ProviderService on :$PROVIDER_PORT ..."
( cd "$PROVIDER_DIR" && npx cds-serve --port "$PROVIDER_PORT" 2>&1 | prefix provider ) &
pids+=($!)

sleep 2

echo "[02-replicate] Starting consumer on :$CONSUMER_PORT ..."
( cd "$CONSUMER_DIR" && npx cds-serve --port "$CONSUMER_PORT" 2>&1 | prefix consumer ) &
pids+=($!)

sleep 4

echo ""
echo "[02-replicate] Ready."
echo "  Pipeline Console:     http://localhost:$CONSUMER_PORT/pipeline-console/"
echo "  Management API:       http://localhost:$CONSUMER_PORT/pipeline/Pipelines"
echo "  ReplicatedProducts:   http://localhost:$CONSUMER_PORT/odata/v4/shop/ReplicatedProducts"
echo "  CategoryStats (SQL):  http://localhost:$CONSUMER_PORT/odata/v4/shop/CategoryStats"
echo ""
echo "  ReplicatedCustomers is preloaded at startup. Trigger ReplicatedProducts:"
echo "    curl -X POST \"http://localhost:$CONSUMER_PORT/pipeline/Pipelines(name='ReplicatedProducts')/start\" -H 'Content-Type: application/json' -d '{\"mode\":\"full\"}'"
echo "[02-replicate] Ctrl+C to stop."

wait
