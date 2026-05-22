# Example 03 — Materialize CQN aggregate

**What this shows:** query-shape pipelines that materialize the result of a CQN aggregate query as a local snapshot — both `refresh: 'full'` (rebuild the whole snapshot) and `refresh: { mode: 'partial', slice }` (rebuild only the affected slice). See [docs/guide/recipes/built-in-materialize.md](../../docs/guide/recipes/built-in-materialize.md).

**Source:** in-process `SalesService.Orders`.
**Targets:**
- `example03.DailyCustomerRevenue` — rebuilt in full on every run.
- `example03.RecentCustomerRevenue` — rebuilt only where `lastActivity > tracker.lastSync`.

No external providers needed; everything runs inside this one CAP app.

## Run it

```bash
bash examples/03-materialize-cqn/start.sh
```

- Orders (source): <http://localhost:4103/odata/v4/sales/Orders>
- Reporting (targets): <http://localhost:4103/odata/v4/reporting/DailyCustomerRevenue>, <http://localhost:4103/odata/v4/reporting/RecentCustomerRevenue>
- Pipeline Monitor: <http://localhost:4103/launchpage.html>

Stop with Ctrl+C.

## The `source.query` closure

```js
source: {
    kind: 'cqn',
    service: 'SalesService',
    query: (tracker) => SELECT
        .from('SalesService.Orders')
        .columns(
            'customerId as customerId',
            { func: 'sum',   args: [{ ref: ['amount'] }],     as: 'totalAmount' },
            { func: 'count', args: ['*'],                     as: 'orderCount' },
            { func: 'max',   args: [{ ref: ['modifiedAt'] }], as: 'lastActivity' },
        )
        .where({ status: 'completed' })
        .groupBy('customerId'),
},
refresh: 'full',
```

Key points:

- **Query-shape pipeline.** The presence of `source.query` flips the pipeline into query-shape mode. Row-delta modes (`timestamp`, `key`, `datetime-fields`) are rejected by validation; only `refresh: 'full'` or `refresh: { mode: 'partial', slice }` are accepted. See [concepts/inference.md](../../docs/guide/concepts/inference.md).
- **Plain closure, not `async`.** `cds.ql` builders are thenable — `await`ing one executes it. Keep `source.query` a non-async function that *returns* the builder; the runtime awaits it against the configured source service.
- **`refresh: 'full'`.** Target table is truncated and the aggregate rows are re-inserted inside one transaction. Crash-safe at the transaction boundary: the previous snapshot stays intact on failure.
- **`refresh: { mode: 'partial', slice }`.** The `slice` predicate is applied as a DELETE against the target before the INSERT. The `source.query` is narrowed to produce the same slice so inserts don't collide with stale unchanged rows.

## Tracker mode vs refresh mode

The persisted tracker enum is `{ delta, full }`. `refresh: 'partial'` is accepted by validation but stored as `mode = 'full'` on the tracker — the Pipeline Monitor shows both pipelines in this example with `mode=full`. The difference between them is the slice each rebuilds, not a separate stored mode.

## Scenarios

`http/10-run-and-query.http` walks through:

1. Full refresh — reads every completed order, rebuilds the snapshot.
2. Partial refresh — first run has no watermark, produces the same result.
3. Insert a new completed order.
4. Partial refresh again — only the touched customer's aggregate row is rebuilt; the others are untouched. Compare against a second full refresh that unconditionally rebuilds all of them.

## See also

- [Recipes → Built-in materialize](../../docs/guide/recipes/built-in-materialize.md) — reference walkthrough.
- [Sources → CQN](../../docs/guide/sources/cqn.md) — adapter options and both query shapes.
- [Example 01 — Replicate OData](../01-replicate-odata/) — the entity-shape twin recipe.
