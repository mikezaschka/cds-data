const cds = require('@sap/cds')

// Two pipelines against the same in-process `SalesService.Orders`:
//   - `DailyCustomerRevenue`       — full refresh, rebuilds the whole snapshot
//   - `RecentCustomerRevenue`      — partial refresh with a tracker-scoped slice
//
// Both land in the same `example03.DailyCustomerRevenue` table in two
// runs so you can compare the shapes side by side without ever running
// them concurrently (see http/10-run-and-query.http).
cds.on('served', async () => {
    const pipelines = await cds.connect.to('DataPipelineService')

    // ── Full refresh ──────────────────────────────────────────────────
    // The closure returns a CQN; when the runtime calls it, the query is
    // executed against SalesService (in-process CAP service). `refresh:
    // 'full'` clears the target table and replays every aggregate row.
    await pipelines.addPipeline({
        name: 'DailyCustomerRevenue',
        source: {
            kind: 'cqn',
            service: 'SalesService',
            query: () => SELECT
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
        target: { entity: 'example03.DailyCustomerRevenue' },
        refresh: 'full',
    })

    // ── Partial refresh ───────────────────────────────────────────────
    // Rebuilds only the aggregates that changed since the last successful
    // run. The `slice` predicate is used by the DbTargetAdapter to DELETE
    // the matching rows; the `source.query` must be narrowed to produce
    // the SAME slice or the INSERT will clash with stale rows.
    //
    // Note: `refresh: 'partial'` is accepted by `execute` / validation but
    // is stored as `mode = 'full'` on the tracker (the persisted enum is
    // `{ delta, full }`). The Pipeline Monitor shows both pipelines with
    // mode=full; they differ only in the slice they refresh.
    await pipelines.addPipeline({
        name: 'RecentCustomerRevenue',
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
                .where({
                    status: 'completed',
                    modifiedAt: { '>': tracker.lastSync || '1970-01-01' },
                })
                .groupBy('customerId'),
        },
        target: { entity: 'example03.RecentCustomerRevenue' },
        refresh: {
            mode: 'partial',
            slice: (tracker) => ({
                lastActivity: { '>': tracker.lastSync || '1970-01-01' },
            }),
        },
    })
})

module.exports = cds.server
