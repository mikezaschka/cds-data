# Built-in materialize

**When to pick this recipe:** you want to store the result of a SELECT query — aggregates, joins, DISTINCT, computed columns — as a snapshot in a target table, refreshed on a schedule. Source is a CQN-native service (in-process CAP service, `cds.requires` DB binding), target is the local DB, no custom code.

Inference: a pipeline is *query-shape* when `addPipeline(...)` is given a `source.query` closure. `mode: 'full'` is inferred and writes go through the default [`DbTargetAdapter`](../targets/db.md) (see [Inference rules](../concepts/inference.md)). "Materialize" is a doc-level use-case label — nothing is stored on the pipeline row.

Materialize pipelines are always paired with the [CQN adapter](../sources/cqn.md). Other source adapters are not appropriate: CAP cannot translate aggregate queries across OData or REST, and entity-shape reads cannot express GROUP BY.

!!! tip "Prefer declarative CDS?"
    For `group by` projections annotated with `@materialize.snapshot`, use [cds-data-materialization](/materialization/) — it compiles the projection to `source.query` and registers the pipeline automatically. This recipe documents the programmatic engine API directly.

## Worked example — `DailyCustomerRevenue`

A typical scenario: a sales service records individual orders; a reporting dashboard needs per-customer totals and order counts, updated nightly. Keeping the aggregate materialized avoids re-aggregating the full orders table on every dashboard request.

### Schema

```cds
namespace reporting;

@cds.persistence.table
entity DailyCustomerRevenue {
    key customerId   : String(10);
        totalAmount  : Decimal(15,2);
        orderCount   : Integer;
        lastActivity : Timestamp;
}
```

### Registration

`source.query` is a closure that returns a CQN SELECT. You can write it in either of the two styles CAP supports — the fluent builder (`SELECT.from(...).columns(...)`) or `cds.ql` tagged templates — and mix them where one reads better than the other. Both produce the same CQN and flow through the CQN adapter identically (see the official [CQL reference](https://cap.cloud.sap/docs/cds/cql) and [CQN notation](https://cap.cloud.sap/docs/cds/cqn)).

::: code-group

```javascript [Fluent builder]
const cds = require('@sap/cds');

module.exports = async () => {
    const pipelines = await cds.connect.to('DataPipelineService');

    await pipelines.addPipeline({
        name: 'DailyCustomerRevenue',
        schedule: '0 2 * * *',                              // nightly at 02:00

        source: {
            kind: 'cqn',
            service: 'SalesService',
            query: () => SELECT
                .from('SalesService.Orders')
                .columns(
                    'customer_id as customerId',
                    { func: 'sum',   args: [{ ref: ['amount'] }],     as: 'totalAmount' },
                    { func: 'count', args: ['*'],                     as: 'orderCount'  },
                    { func: 'max',   args: [{ ref: ['modifiedAt'] }], as: 'lastActivity' },
                )
                .where({ status: 'completed' })
                .groupBy('customer_id'),
        },

        target: { entity: 'reporting.DailyCustomerRevenue' },
        refresh: 'full',
    });
};
```

```javascript [`cds.ql` tagged templates]
const cds = require('@sap/cds');

module.exports = async () => {
    const pipelines = await cds.connect.to('DataPipelineService');

    await pipelines.addPipeline({
        name: 'DailyCustomerRevenue',
        schedule: '0 2 * * *',                              // nightly at 02:00

        source: {
            kind: 'cqn',
            service: 'SalesService',
            query: () => SELECT `
                customer_id     as customerId,
                sum(amount)     as totalAmount,
                count(*)        as orderCount,
                max(modifiedAt) as lastActivity
            ` .from `SalesService.Orders`
              .where `status = 'completed'`
              .groupBy `customer_id`,
        },

        target: { entity: 'reporting.DailyCustomerRevenue' },
        refresh: 'full',
    });
};
```

:::

The presence of `source.query` marks this as a query-shape (snapshot-write) pipeline; `mode: 'full'` and `delta.mode: 'full'` are the inferred defaults. Snapshot writes require a target adapter that supports `batchInsert` — the default `DbTargetAdapter` does.

::: warning Don't `await` the query inside the closure
`cds.ql` builders are *thenable* — `await`ing one executes it against the ambient `cds.context` and returns rows, not a CQN. Keep `source.query` a plain (non-`async`) closure that *returns* the builder; the SELECT runs against the configured source service.
:::

### Interpolating the tracker watermark

Tagged templates are especially handy when the query depends on the tracker — `${...}` values are safely parameterized by CAP:

```javascript
query: (tracker) => SELECT `
    customer_id as customerId,
    sum(amount) as totalAmount
` .from `SalesService.Orders`
  .where `status = 'completed' and modifiedAt > ${tracker.lastSync ?? '1970-01-01'}`
  .groupBy `customer_id`
```

The equivalent on the builder is `.where({ status: 'completed', modifiedAt: { '>': tracker.lastSync ?? '1970-01-01' } })`. Pick whichever you find more readable.

### What happens at runtime

1. Schedule fires (or the run is triggered manually via the management service).
2. A transaction is opened.
3. `source.query(tracker)` is called and the returned CQN is executed against `SalesService`.
4. The snapshot is cleared (`DELETE FROM reporting.DailyCustomerRevenue`).
5. The MAP phase runs (default: identity — aggregate results already match the target shape); user hooks can enrich.
6. The WRITE phase inserts the aggregated rows.
7. The transaction commits. If any step fails, the transaction rolls back and the previous snapshot remains intact.

### Partial refresh

For larger aggregates where rebuilding the whole snapshot is wasteful, declare a slice:

```javascript
refresh: {
    mode: 'partial',
    slice: (tracker) => ({
        // Only refresh aggregates that changed since the last successful run.
        lastActivity: { '>': tracker.lastSync || '1970-01-01' },
    }),
},
```

Rows matching the slice predicate are deleted before the new aggregate rows are inserted. The source query should be narrowed to produce the same slice (otherwise the INSERT will collide with the unchanged rows).

### Event hooks

All standard pipeline hooks (`PIPELINE.START`, `PIPELINE.READ`, `PIPELINE.MAP`, `PIPELINE.WRITE`, `PIPELINE.DONE`) fire for materialize runs exactly as they do for replicate. The WRITE phase receives the aggregated rows in `req.data.targetRecords` and runs the default `DELETE + INSERT`; user `PIPELINE.WRITE` hooks can observe or replace the default write path.

## Constraints

- `source.query` is required (that is the signal that makes the pipeline query-shape in the first place).
- Row-delta modes (`timestamp`, `key`, `datetime-fields`) are rejected — they do not fit aggregate semantics. Only `refresh: 'full'` and `refresh: { mode: 'partial', slice }` are recognized.
- `refresh: 'full'` is not crash-safe beyond the transaction boundary. The snapshot is consistent per successful run; mid-run crashes leave the previous snapshot intact but do not resume.
- The aggregate result is read in one batch. Very large aggregates should be partitioned via multiple pipelines over non-overlapping slices.

## See also

- [Concepts → Inference rules](../concepts/inference.md) — the full shape-to-behavior table.
- [Sources → CQN adapter](../sources/cqn.md) — adapter reference covering both shapes.
- [Targets → Local DB](../targets/db.md) — where the snapshot lands.
- [Reference → Management Service](../../reference/management-service.md) — triggering and inspecting runs.
- [Reference → Features](../../reference/features.md) — full capability overview.
- [capire → CQL (Core Query Language)](https://cap.cloud.sap/docs/cds/cql) — CDS query language reference.
- [capire → CQN (Core Query Notation)](https://cap.cloud.sap/docs/cds/cqn) — JSON shape that `source.query` must ultimately return.
- [capire → Node.js `cds.ql`](https://cap.cloud.sap/docs/node.js/cds-ql) — `SELECT` builder, tagged-template form, and parameter interpolation.
