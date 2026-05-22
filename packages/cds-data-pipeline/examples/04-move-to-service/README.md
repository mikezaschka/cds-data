# Example 04 — Move to service

**What this shows:** write pipeline output to a remote OData target via the built-in `ODataTargetAdapter`. No local DB table for the target — rows flow over HTTP(S) straight into another service. See [docs/guide/targets/odata.md](../../docs/guide/targets/odata.md) and [docs/guide/recipes/built-in-replicate.md#to-a-remote-odata-target](../../docs/guide/recipes/built-in-replicate.md).

**Source:** `LogisticsService.Shipments` at `http://localhost:4455/odata/v4/logistics/`.
**Target:** `LogisticsService.ShipmentArchive` on the **same** provider (a separate service would look identical — just a different `target.service` name in `cds.requires`).
**Pipeline name:** `ShipmentArchive`.

## Run it

```bash
bash examples/04-move-to-service/start.sh
```

- Source entity: <http://localhost:4455/odata/v4/logistics/Shipments>
- Target entity: <http://localhost:4455/odata/v4/logistics/ShipmentArchive>
- Pipeline Monitor: <http://localhost:4104/launchpage.html>
- Management service: <http://localhost:4104/pipeline/Pipelines>

Stop with Ctrl+C.

## Adapter selection

```js
target: {
    service:    'LogisticsService',     // defined in cds.requires with kind: 'odata'
    entity:     'LogisticsService.ShipmentArchive',
    batchSize:  200,
    maxRetries: 3,
    retryDelay: 1000,
},
```

The plugin auto-resolves the target adapter from the connected remote service's `kind`. Since `LogisticsService` is declared with `kind: 'odata'` in [package.json](package.json), `ODataTargetAdapter` is selected. Writes flow as `UPSERT.into('LogisticsService.ShipmentArchive').entries(batch)` through CAP's connected remote service — translated to POST / PATCH (and DELETE on full refresh) on the wire, with `$batch` change sets where the backend supports them.

## Row reshaping

Source and target don't have identical shapes:

- `Shipments.carrier.code` → `ShipmentArchive.carrierCode` (association → plain column) — handled by the `viewMapping.remoteToLocal` entry.
- `ShipmentArchive.archivedAt` — has no source column; stamped by an `after('PIPELINE.MAP_BATCH', ...)` hook in [server.js](server.js).

The built-in `PIPELINE.MAP_BATCH` default runs the rename; the user hook runs afterwards and enriches each row with `archivedAt`. No custom source code — everything sits on top of the built-in adapters.

## O(n) full refresh tradeoff

OData has no bulk DELETE primitive. `mode: 'full'` on an OData target does a key-scan SELECT followed by per-key DELETE before the fresh INSERT batch — O(n) round-trips. For any non-trivial target, prefer `mode: 'delta'` and only refresh on schema changes or after a long gap.

## Scenarios

Walk through `http/10-run-and-query.http`:

1. Delta run — rows POSTed to the target, `archivedAt` stamped on each.
2. Direct query against the provider — rows are there.
3. Second run — 0 writes (nothing changed upstream).
4. Full refresh — observe the O(n) behaviour. Statistics on the tracker attribute all writes to `created` because the remote runtime does not distinguish insert from update during UPSERT.

## Known limitations

- Statistics bias: `created` counts every UPSERTed row. See [docs/guide/targets/odata.md](../../docs/guide/targets/odata.md#known-limitations).
- `truncate` / `deleteSlice` use read-then-delete without ETag guards; concurrent writers on the provider can leak rows past the sweep.
- Not suitable for very large targets — shift to a [custom target adapter](../../docs/guide/targets/custom.md) that exposes a provider-side clear action.

## See also

- [Targets → OData](../../docs/guide/targets/odata.md) — full reference.
- [Recipes → Built-in replicate → To a remote OData target](../../docs/guide/recipes/built-in-replicate.md).
- [Targets → Custom target adapter](../../docs/guide/targets/custom.md) — when OData isn't the right fit.
