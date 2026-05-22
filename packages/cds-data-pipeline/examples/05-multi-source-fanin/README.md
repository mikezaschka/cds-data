# Example 05 — Multi-source fan-in

**What this shows:** consolidate the same logical entity from N backends into one local table, stamping each row with the backend it came from. Per-origin flush and `mode: 'full'` refreshes leave sibling origins untouched. See [docs/guide/recipes/multi-source.md](../../docs/guide/recipes/multi-source.md).

**Sources:** two LogisticsService instances with distinct seed data — DEV on `:4455`, PROD on `:4465`. Both are the same `_providers/logistics-service` package running with `LOGISTICS_ORIGIN=DEV` / `LOGISTICS_ORIGIN=PROD`; a `cds.on('served')` hook in the provider swaps in origin-specific `Shipments` rows.

**Target:** `example05.Shipments` — a local table that mixes in the plugin's `sourced` aspect to extend its key with a `source` discriminator.

**Pipelines:** `Shipments_DEV` (origin `DEV`) and `Shipments_PROD` (origin `PROD`).

## Run it

```bash
bash examples/05-multi-source-fanin/start.sh
```

- Consolidated local: <http://localhost:4105/odata/v4/example/Shipments>
- DEV source: <http://localhost:4455/odata/v4/logistics/Shipments>
- PROD source: <http://localhost:4465/odata/v4/logistics/Shipments>
- Pipeline Monitor: <http://localhost:4105/launchpage.html>

Stop with Ctrl+C.

## The three pieces

### 1. Per-backend `cds.requires` entries

```json
"LogisticsDev":  { "kind": "odata", "model": "srv/external/LogisticsDev",  "credentials": { "url": "http://localhost:4455/odata/v4/logistics" } },
"LogisticsProd": { "kind": "odata", "model": "srv/external/LogisticsProd", "credentials": { "url": "http://localhost:4465/odata/v4/logistics" } }
```

Two named entries, two distinct CSNs (the service namespace inside each CSN must match the entry name so CAP can bind the metadata). The schemas are identical; only the service name and URL differ.

### 2. Target mixes in the `sourced` aspect

```cds
using { plugin.data_pipeline.sourced } from 'cds-data-pipeline/db';

@cds.persistence.table
entity Shipments : sourced {
    key ID                : UUID;
        orderId           : Integer;
        // …
}
```

The `sourced` aspect (from [cds-data-pipeline/db](../../db/index.cds)) adds `key source : String(100)` — extending the key so rows with the same business key but different origins coexist. Without this aspect, `addPipeline` rejects `source.origin` at registration time with an error that names the exact import path.

### 3. One pipeline per backend, differing only in `source.service` + `source.origin`

```js
await pipelines.addPipeline({
    name: 'Shipments_DEV',
    source: { service: 'LogisticsDev',  entity: 'LogisticsDev.Shipments',  origin: 'DEV' },
    target: { entity: 'example05.Shipments' },
    delta:  { mode: 'timestamp', field: 'modifiedAt' },
    viewMapping: { /* shared with the PROD sibling */ },
});
await pipelines.addPipeline({
    name: 'Shipments_PROD',
    source: { service: 'LogisticsProd', entity: 'LogisticsProd.Shipments', origin: 'PROD' },
    target: { entity: 'example05.Shipments' },
    // same target, same delta mode, same viewMapping
});
```

## What `source.origin` does behind the scenes

| Phase | With `source.origin` | Without |
|---|---|---|
| Registration | Writes `origin` to `Pipelines.origin` on the tracker | `origin` is null |
| `PIPELINE.MAP_BATCH` default | Stamps `row.source = origin` on every mapped row | No stamp |
| `PIPELINE.WRITE_BATCH` default | Re-stamps `source = origin` (belt + braces), UPSERTs with compound key `(businessKey, source)` | UPSERTs with declared business key only |
| `mode: 'full'` pre-sync | `DELETE FROM target WHERE source = origin` — siblings survive | Full `DELETE FROM target` |
| Per-pipeline `flush` | Only deletes the matching origin's rows | Deletes the full target |

You never handle `origin` in your own hooks. The plugin makes it disappear into the default MAP / WRITE path.

## Scenarios

Walk through `http/10-run-and-query.http`:

1. Run DEV first — rows with `source='DEV'`.
2. Run PROD — rows with `source='PROD'`; DEV rows untouched.
3. `$filter=source eq '...'` — query per origin.
4. Flush DEV only — PROD rows survive (per-origin delete on the tracker).
5. `mode: 'full'` on DEV — scoped DELETE + replay; PROD still untouched.

## Constraints `addPipeline` enforces

- **`source.origin` without the `sourced` aspect on the target** — rejected.
- **`source.origin` + `source.query`** — rejected. Materialize rebuilds a snapshot and is origin-agnostic; for per-origin aggregates use per-origin base tables + a shared materialize pipeline on top.

## See also

- [Recipes → Multi-source](../../docs/guide/recipes/multi-source.md) — the reference walkthrough.
- [Concepts → Inference rules](../../docs/guide/concepts/inference.md) — where `origin` fits in the pipeline-kind table.
- [Example 01 — Replicate OData](../01-replicate-odata/) — the single-origin baseline.
