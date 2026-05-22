# OData (`ODataTargetAdapter`)

`ODataTargetAdapter` forwards writes to a remote OData V2 / V4 service through CAP's connected remote service. It is selected automatically when `target.kind` is `'odata'` / `'odata-v2'` or when the connected remote service advertises that kind via `service.options.kind`. No custom code is required — point `target.service` at a CAP service registered with `kind: 'odata'` (or `'odata-v2'`) and the adapter takes over.

Writes dispatch through CQN — `writeBatch` issues `UPSERT.into(entity).entries(records)` (or `INSERT` in snapshot mode) and CAP's remote runtime translates to POST / PUT / PATCH / DELETE (with `$batch` change sets where supported). OData has no bulk DELETE, so `truncate` and `deleteSlice` are `O(n)` round-trips on large targets — prefer `mode: 'delta'` for high-volume pipelines.

## Registration

```javascript
await pipelines.addPipeline({
    name: 'CustomersToCrm',
    source: { service: 'OrdersOData', entity: 'Orders' },
    target: {
        service: 'CrmOData',
        entity: 'Customers',
        kind: 'odata',           // optional; auto-detected from service.options.kind
        batchSize: 500,          // page size for key-scan SELECTs and write chunks
        keyColumns: ['ID'],      // optional; defaults to CDS model keys
        maxRetries: 3,           // optional; retries per CQN call
        retryDelay: 1000,        // optional; base backoff in ms
    },
    mode: 'delta',
});
```

## Capabilities

```javascript
{
    batchInsert:          true,
    keyAddressableUpsert: true,
    batchDelete:          true,
    truncate:             true,
}
```

All four capabilities are supported, so `mode: 'delta'`, `mode: 'full'`, and `source.query` snapshots all register cleanly. See [Known limitations](#known-limitations) for caveats on large-target full refreshes.

## Tuning knobs

Read off `config.target`:

| Key | Default | Purpose |
|---|---|---|
| `batchSize` | `1000` | Page size for truncate / deleteSlice key scans and write chunks. |
| `keyColumns` | `Object.keys(cds.model.definitions[entity].keys)` | Override key columns used for per-row DELETEs. |
| `maxRetries` | `3` | Retries on transient (non-4xx) failures. |
| `retryDelay` | `1000` (ms) | Base backoff before first retry. |

## Known limitations

- Statistics from `writeBatch` attribute all rows to `created`; CAP's remote runtime does not distinguish inserts from updates during UPSERT.
- `truncate` / `deleteSlice` do a read-then-delete without ETag guards; a concurrent writer on the provider can leak rows past the sweep.
- Large targets: prefer `mode: 'delta'` or a provider-side clear action behind a [custom target adapter](custom.md).

## Worked example

See [Recipes → Built-in replicate → To a remote OData target](../recipes/built-in-replicate.md#to-a-remote-odata-target).

## See also

- [Targets → overview](index.md) — resolution order and the capability-gating matrix.
- [Targets → Custom target adapter](custom.md) — for non-OData remote targets.
- [Sources → OData V2 / V4](../sources/odata.md) — OData on the READ side.
- [Concepts → Inference rules](../concepts/inference.md) — target adapter selection and registration validation.
