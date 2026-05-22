# CQN Adapter

The CQN adapter reads from any CAP-addressable service whose wire protocol is native CQN: in-process CAP application services, `cds.requires` database bindings (`sqlite`, `hana`, `postgres`, `better-sqlite`, `sql`), CAP-wrapped legacy databases via `@sap/cds-dbs`. Unlike the OData and REST adapters, it does not translate queries across protocols — the query runs directly on the connected service.

The CQN adapter serves both pipeline read shapes:

| Read shape | Signal | Target write | Delta modes |
|---|---|---|---|
| **Entity-shape** (row-preserving) | `source.entity` set, `source.query` absent | UPSERT per batch — idempotent across re-runs | `timestamp`, `key` |
| **Query-shape** (derived snapshot) | `source.query(tracker)` closure returning a SELECT CQN | `DELETE + INSERT` (full refresh) or scoped `DELETE + INSERT` (partial refresh) | `full` (default), `partial-refresh` |

Route to this adapter via `source.kind: 'cqn'` on the `addPipeline` config. For CQN-kind `cds.requires` bindings the adapter is also selected automatically. See [Inference rules](../concepts/inference.md) for the full shape-to-behavior table.

## Entity-shape read (row-preserving)

Row-preserving copy from a CQN-native source. The target entity's projection defines the schema — column restriction, renames, and `where` clauses declared on the projection flow through the view mapping exactly as they do for the OData adapter.

```javascript
const pipelines = await cds.connect.to('DataPipelineService');

await pipelines.addPipeline({
    name: 'ArchivedOrders',
    source: {
        kind: 'cqn',
        service: 'reporting',           // cds.requires binding; kind: 'postgres' | 'hana' | ...
        entity: 'reporting.Orders',
        batchSize: 1000,
    },
    target: { entity: 'local.ArchivedOrders' },
    mode: 'delta',
    delta: { mode: 'timestamp', field: 'modifiedAt' },
});

await pipelines.execute('ArchivedOrders');
```

The presence of `source.entity` (and absence of `source.query`) marks this as an entity-shape pipeline. See [Inference rules → Read shape](../concepts/inference.md#read-shape). The CQN adapter is selected automatically when the service declared in `cds.requires` has a CQN-native `kind` (`postgres`, `hana`, `sqlite`, `better-sqlite`, in-process CAP services, …), or explicitly via `source.kind: 'cqn'`.

### Constraints

- `source.entity` is required. If absent, `addPipeline` rejects the config as *missing source shape* (see [Inference rules → Registration validation](../concepts/inference.md#registration-validation-matrix)).
- `source.query` is incompatible with entity-shape reads. If you want `source.query`, omit `source.entity`; the plugin will infer query-shape semantics (see next section).

## Query-shape read (derived snapshot)

Derived / aggregated snapshot. The closure `source.query(tracker)` receives the pipeline's tracker row and returns a SELECT CQN — aggregates, GROUP BY, DISTINCT, computed columns, whatever the connected service can execute. The result is loaded into the target in a single batch (no pagination — aggregate results are typically small enough to fit in memory).

`source.query` can be written in either CAP style — the fluent builder or `cds.ql` tagged templates. Both produce the same SELECT that the source service can run. See the official CAP references: [CQL (Core Query Language)](https://cap.cloud.sap/docs/cds/cql), [CQN (Core Query Notation)](https://cap.cloud.sap/docs/cds/cqn), and [`cds.ql`](https://cap.cloud.sap/docs/node.js/cds-ql).

::: code-group

```javascript [Fluent builder]
await pipelines.addPipeline({
    name: 'DailyCustomerRevenue',
    schedule: '0 2 * * *',                              // nightly at 02:00
    source: {
        kind: 'cqn',
        service: 'SalesService',
        query: () => SELECT
            .from('SalesService.Orders')
            .columns(
                'customer_id as customerID',
                { func: 'sum',   args: [{ ref: ['amount'] }],     as: 'totalAmount' },
                { func: 'count', args: ['*'],                     as: 'orderCount'  },
                { func: 'max',   args: [{ ref: ['modifiedAt'] }], as: 'lastActivity' },
            )
            .where({ status: 'completed' })
            .groupBy('customer_id'),
    },
    target: { entity: 'reporting.DailyCustomerRevenue' },
    refresh: 'full',                                    // default
});
```

```javascript [`cds.ql` tagged templates]
await pipelines.addPipeline({
    name: 'DailyCustomerRevenue',
    schedule: '0 2 * * *',                              // nightly at 02:00
    source: {
        kind: 'cqn',
        service: 'SalesService',
        query: () => SELECT `
            customer_id     as customerID,
            sum(amount)     as totalAmount,
            count(*)        as orderCount,
            max(modifiedAt) as lastActivity
        ` .from `SalesService.Orders`
          .where `status = 'completed'`
          .groupBy `customer_id`,
    },
    target: { entity: 'reporting.DailyCustomerRevenue' },
    refresh: 'full',                                    // default
});
```

:::

The presence of `source.query` marks this pipeline as query-shape. The inferred defaults are `mode: 'full'` and `delta.mode: 'full'`.

::: warning Don't `await` the query inside the closure
`cds.ql` builders are *thenable* — `await`ing one executes it against the ambient `cds.context` and returns rows, not a CQN. Keep `source.query` a plain (non-`async`) closure that *returns* the builder; the pipeline runs the SELECT against the configured source service.
:::

Tagged templates are especially convenient when the query depends on the tracker — `${...}` values are safely parameterized by CAP:

```javascript
query: (tracker) => SELECT `
    customer_id as customerID,
    sum(amount) as totalAmount
` .from `SalesService.Orders`
  .where `status = 'completed' and modifiedAt > ${tracker.lastSync ?? '1970-01-01'}`
  .groupBy `customer_id`
```

The equivalent on the builder is `.where({ status: 'completed', modifiedAt: { '>': tracker.lastSync ?? '1970-01-01' } })`. Styles can be mixed freely — for example, `.columns(...)` with expression objects and `.where` as a tagged template.

### Refresh modes

| Mode | Behavior | Idempotent? |
|---|---|---|
| `refresh: 'full'` (default) | `DELETE FROM target` + `INSERT` of the aggregated rows, wrapped in a single transaction. An aborted run rolls back and leaves the previous snapshot intact. | Yes — every run produces the same target state given the same source. |
| `refresh: { mode: 'partial', slice: (tracker) => predicate }` | `DELETE FROM target WHERE <slice predicate>` + `INSERT`. Only rows matching the slice are replaced. The slice predicate is mandatory — it is not derived from the source query. | Yes within the slice. |

The partial-refresh `slice` closure receives the same tracker row as `source.query` and must return a CQN WHERE predicate:

```javascript
refresh: {
    mode: 'partial',
    slice: (tracker) => ({
        orderedAt: { '>': tracker.lastSync || '1970-01-01' },
    }),
},
```

### Constraints

- `source.query` must be a closure returning a SELECT CQN. Non-SELECT statements (`INSERT`, `UPDATE`, `DELETE`, `UPSERT`) are rejected at runtime.
- Row-delta modes (`timestamp`, `key`, `datetime-fields`) are rejected at registration — they do not fit aggregate semantics (a new source row mutates an existing target aggregate rather than producing a fresh target row). Use `mode: 'full'` or `mode: 'partial-refresh'` with a `slice`.
- `refresh: 'full'` is not crash-safe beyond the transaction boundary. If the process dies mid-run the transaction rolls back and the previous snapshot remains intact; there is no resume-from-checkpoint for aggregated snapshots.

## Authentication

No new auth path. The adapter uses `cds.requires[source.service]` exactly like the OData and REST adapters. Credential blocks, SAP Cloud SDK destinations, and service bindings all work unchanged.

## See also

- [Concepts → Inference rules](../concepts/inference.md) — the full shape-to-behavior table.
- [Recipes → Built-in materialize](../recipes/built-in-materialize.md) — worked `DailyCustomerRevenue` example end-to-end.
- [Sources → OData V2 / V4](odata.md) — OData-specific adapter.
- [Sources → REST Adapter](rest.md) — REST-specific adapter.
- [Reference → Management Service](../../reference/management-service.md) — programmatic `addPipeline` API.
- [capire → CQL (Core Query Language)](https://cap.cloud.sap/docs/cds/cql) — CDS query language reference.
- [capire → CQN (Core Query Notation)](https://cap.cloud.sap/docs/cds/cqn) — JSON shape that `source.query` must ultimately return.
- [capire → Node.js `cds.ql`](https://cap.cloud.sap/docs/node.js/cds-ql) — `SELECT` builder, tagged-template form, and parameter interpolation.
