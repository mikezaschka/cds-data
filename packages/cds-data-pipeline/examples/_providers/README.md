# Example providers

Two backends shared by the numbered examples under `examples/`. Each numbered example starts whichever of these it needs and adds its own consumer CAP app on top.

| Provider | Port | Kind | Used by |
|---|---|---|---|
| `logistics-service/` (DEV origin) | 4455 | CAP OData V4 | 01, 04, 05, 06, 07 |
| `logistics-service/` (PROD origin) | 4465 | CAP OData V4 | 05 |
| `fx-service/` | 4456 | Express REST | 02 |

## LogisticsService

A minimal CAP V4 service exposing `Carriers`, `Shipments`, `TrackingEvents`, and `ShipmentArchive`. The same code runs two instances with different seed data when `LOGISTICS_ORIGIN=DEV` or `LOGISTICS_ORIGIN=PROD` is set — a `cds.on('served')` hook reseeds `Shipments` with origin-specific rows so example 05 can consolidate two distinct backends into one target table via the `source.origin` fan-in recipe.

`ShipmentArchive` is a writable entity used by example 04 as the target of `ODataTargetAdapter` — the pipeline reads from somewhere else and POSTs / PATCHes rows into this entity through CAP's connected-service runtime.

**Test emit actions** (`emitShipmentKeyTest`, `emitShipmentPayloadTest`) publish CAP messaging events for [example 07](../07-event-driven-runs/). Topics are defined in `logistics-service/lib/event-topics.js`. Provider and consumer share the default file-based messaging outbox (`~/.cds-msg-box`) in development.

An optional `LOGISTICS_CARRIERS_DELAY_MS` env var injects an artificial delay on `Carriers` reads; defaults to 0. Useful only as a retry / resilience demo.

## FXService

A plain Express app serving `GET /api/rates` with offset pagination (`limit`, `offset`), a `modifiedSince` filter, and a `{ results, total }` envelope — matching what the built-in `RestAdapter` expects with `pagination: { type: 'offset' }`, `deltaParam: 'modifiedSince'`, and `dataPath: 'results'`. Example 02 replicates from this endpoint.

## Running

```bash
# Default — logistics DEV + FX
bash examples/_providers/start-providers.sh

# Both logistics instances + FX (what example 05 needs)
LOGISTICS_PROD=1 bash examples/_providers/start-providers.sh
```

Each example's `start.sh` calls this script with the right env. Running it directly is only useful when hacking on the providers themselves.
