---
name: replicate-consumption-view
description: Creates @federation.replicate consumption views for scheduled remote-to-local sync in SAP CAP. Use when copying remote OData or REST data locally, configuring schedule, delta sync, or the replicated aspect.
---

# Replicate consumption view

## Prerequisites

```bash
npm add cds-data-federation cds-data-pipeline
```

`@federation.replicate` binds an entity-shape pipeline at boot. Without `cds-data-pipeline`, startup fails with an actionable error.

## OData replicate

```cds
using { ProviderService as remote } from '../srv/external/ProviderService';

@federation.replicate: {
    schedule: 600000,
    delta: { field: 'modifiedAt', mode: 'timestamp' }
}
entity ReplicatedProducts as projection on remote.Products {
    ID, name, category, price, modifiedAt
};
```

## Optional `replicated` aspect

```cds
using { plugin.data_federation as federation } from 'cds-data-federation';

entity ReplicatedProducts : federation.replicated {
    key ID : UUID;
    name   : String;
    // lastReplicatedAt, lastReplicatedBy added by aspect
};
```

Or annotate a projection as above — the pipeline writes to the local table.

## REST replicate (no CDS model on remote)

```cds
@federation.replicate: {
    source: 'RestProvider',
    schedule: 300000,
    delta: { field: 'modifiedAt' },
    rest: {
        path: '/api/customers',
        pagination: { type: 'offset', pageSize: 100 },
        deltaParam: 'modifiedSince',
        dataPath: 'results'
    }
}
entity ReplicatedRestCustomers {
    key ID   : String(10);
        name : String(100);
        modifiedAt : Timestamp;
}
```

## Key options

| Option | Purpose |
|---|---|
| `schedule` | Interval in ms for `cds.spawn`; omit for manual-only |
| `mode` | `'delta'` (default) or `'full'` |
| `delta.field` | High-watermark field (default `modifiedAt`) |
| `delta.mode` | `'timestamp'`, `'key'`, or `'datetime-fields'` |

## Custom MAP hooks

Consumers rarely call `addPipeline` directly for replicate, but pipeline hooks work:

```javascript
const pipelines = await cds.connect.to('DataPipelineService');
pipelines.before('PIPELINE.MAP', 'ReplicatedProducts', async (req) => {
    req.data.sourceRecords = req.data.sourceRecords.filter(r => !r.blocked);
});
```

Pipeline name defaults to the entity name.

## Anti-patterns

❌ **Wrong** — `@federation.replicate` on an entity without local persistence target.

✅ **Correct** — projection defines the local schema; engine UPSERTs into the db target inferred from the binding.

❌ **Wrong** — `@federation.delegate` for plain REST JSON APIs.

✅ **Correct** — `@federation.replicate` + `rest` config.

## Docs

- First replication: https://mikezaschka.github.io/cds-data-federation/federation/getting-started/first-replication.html
- Annotations: https://mikezaschka.github.io/cds-data-federation/federation/reference/annotations.html
