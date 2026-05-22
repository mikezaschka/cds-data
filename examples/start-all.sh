#!/usr/bin/env bash
# Start all example servers in parallel. Ctrl+C kills them all.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PROVIDER_PORT=4444
STREAMING_PORT=4445
BOX_OFFICE_PORT=4446
CONSUMER_PORT=4004

pids=()

cleanup() {
    echo ""
    echo "[examples] Stopping servers..."
    for pid in "${pids[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
    exit 0
}
trap cleanup INT TERM

# Free ports if leftover from a previous run
for port in $PROVIDER_PORT $STREAMING_PORT $BOX_OFFICE_PORT $CONSUMER_PORT; do
    pid=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo "[examples] Port $port busy (pid $pid) — killing"
        kill -9 "$pid" 2>/dev/null || true
    fi
done

prefix() {
    # Prefix every line of stdin with [name]
    local name="$1"
    sed -u "s/^/[$name] /"
}

echo "[examples] Starting Studio provider (ProviderService V4 + LicensingService V2) on :$PROVIDER_PORT ..."
(cd "$SCRIPT_DIR/provider" && npx cds-serve --port $PROVIDER_PORT 2>&1 | prefix studio) &
pids+=($!)

echo "[examples] Starting Streaming CDN on :$STREAMING_PORT ..."
(cd "$SCRIPT_DIR/inventory" && npx cds-serve --port $STREAMING_PORT 2>&1 | prefix streaming) &
pids+=($!)

echo "[examples] Starting Box-Office REST on :$BOX_OFFICE_PORT ..."
(cd "$SCRIPT_DIR/rest-provider" && PORT=$BOX_OFFICE_PORT node server.js 2>&1 | prefix box-office) &
pids+=($!)

# Give providers a moment to come up before the consumer tries to probe them
sleep 2

# Deploy the consumer schema to SQLite so local entities (Reviews, Bookmarks, ...)
# and plugin tracker tables are materialized. cds-serve does not auto-deploy a
# file-backed SQLite DB; without this step the first request to a local entity
# fails with "no such table: ConsumerService_Reviews".
echo "[examples] Deploying consumer schema to sqlite (db.sqlite) ..."
(cd "$SCRIPT_DIR/consumer" && npx cds deploy db srv --to sqlite:db.sqlite 2>&1 | prefix deploy)

echo "[examples] Starting Consumer on :$CONSUMER_PORT ..."
(cd "$SCRIPT_DIR/consumer" && npx cds-serve --port $CONSUMER_PORT 2>&1 | prefix consumer) &
pids+=($!)

echo ""
echo "[examples] All servers starting. Open:"
echo "  Launchpad:  http://localhost:$CONSUMER_PORT/launchpage.html"
echo "  OData:      http://localhost:$CONSUMER_PORT/odata/v4/consumer/"
echo ""
echo "[examples] Ctrl+C to stop everything."

wait
