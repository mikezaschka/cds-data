#!/usr/bin/env bash
# Start the SAP xtravels reference app with cds-data-federation / cds-data-pipeline:
#   xflights (flight master data, HCQL/OData provider)  :4006
#   HotelsService (xtravels' bundled microservice)       :4008
#   S/4 Business Partner API (mocked)                    :4009
#   xtravels (consumer, replicate + delegate showcase)   :4005
# Ctrl+C kills them all.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

XFLIGHTS_PORT=4006
HOTELS_PORT=4008
S4_PORT=4009
XTRAVELS_PORT=4005

pids=()

cleanup() {
    echo ""
    echo "[xtravels] Stopping servers..."
    for pid in "${pids[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
    exit 0
}
trap cleanup INT TERM

for port in $XFLIGHTS_PORT $HOTELS_PORT $S4_PORT $XTRAVELS_PORT; do
    pid=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo "[xtravels] Port $port busy (pid $pid) — killing"
        kill -9 "$pid" 2>/dev/null || true
    fi
done

prefix() { sed -u "s/^/[$1] /"; }

# xtravels binds to the providers via explicit URLs (profile `federated`), so skip
# CAP's shared ~/.cds-services.json registry: a stale entry there makes `cds mock`
# believe S/4 is already served elsewhere and silently skip mocking it.
export CDS_CONFIG='{"no_bindings":true}'

echo "[xtravels] Starting xflights on :$XFLIGHTS_PORT ..."
(cd "$SCRIPT_DIR/xflights" && npx cds serve --port $XFLIGHTS_PORT 2>&1 | prefix xflights) &
pids+=($!)

echo "[xtravels] Starting HotelsService on :$HOTELS_PORT ..."
(cd "$SCRIPT_DIR/providers/hotels" && npx cds mock sap.capire.hotels.HotelsService --port $HOTELS_PORT 2>&1 | prefix hotels) &
pids+=($!)

echo "[xtravels] Starting mocked S/4 Business Partner API on :$S4_PORT ..."
(cd "$SCRIPT_DIR/s4" && npx cds mock API_BUSINESS_PARTNER --port $S4_PORT 2>&1 | prefix s4) &
pids+=($!)

# The consumer preloads all replicas on boot, so give the providers a head start.
for port in $XFLIGHTS_PORT $HOTELS_PORT $S4_PORT; do
    for _ in $(seq 1 60); do
        curl -s -o /dev/null "http://localhost:$port" && break
        sleep 0.5
    done
done

echo "[xtravels] Starting xtravels on :$XTRAVELS_PORT (profile: federated) ..."
(cd "$SCRIPT_DIR/xtravels" && CDS_ENV=federated npx cds serve --port $XTRAVELS_PORT 2>&1 | prefix xtravels) &
pids+=($!)

echo ""
echo "[xtravels] All servers starting."
echo "  Travels app (Fiori):  http://localhost:$XTRAVELS_PORT/travels/webapp/index.html  (alice / admin)"
echo "  Pipeline Console:     http://localhost:$XTRAVELS_PORT/pipeline-console/"
echo "  Pipeline API:         http://localhost:$XTRAVELS_PORT/pipeline/Pipelines"
echo "  Showcase (delegate):  http://localhost:$XTRAVELS_PORT/showcase/"
echo "  xflights:             http://localhost:$XFLIGHTS_PORT/odata/v4/flights/Flights"
echo "  HotelsService:        http://localhost:$HOTELS_PORT/odata/v4/hotels/Hotels"
echo "  S/4 mock:             http://localhost:$S4_PORT/odata/v4/business-partner/A_BusinessPartner"
echo ""
echo "[xtravels] .http walkthrough: examples/xtravels/requests.http"
echo "[xtravels] Ctrl+C to stop everything."

wait
