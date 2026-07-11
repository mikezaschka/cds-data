const cds = require('@sap/cds')

const LOG = cds.log('cds-data-federation')

// ─── Server-driven paging for delegated reads ─────────────────────────────────
//
// Problem: some remote OData services (e.g., Northwind) cap the number of rows
// they return per request regardless of `$top`. When a client asks the delegate
// handler for 100 rows and the remote returns 20 with `@odata.nextLink`, CAP's
// `srv.run()` returns a plain array and drops the nextLink — so a single call
// to `remote.run(req.query)` silently truncates.
//
// Fix: loop the remote ourselves via `$top`/`$skip` until either
//   - we've collected the client's requested `$top`,
//   - the remote returns an empty batch, or
//   - `maxPages` is reached (safety cap to avoid runaway queries).
//
// The helper is a drop-in replacement for `remote.run(query)` for SELECT-many
// reads. It preserves the `$count` value from the first page (server-side total,
// independent of paging) and re-attaches it to the final array so OData's
// `@odata.count` continues to work.
//
// Products?$top=5000 (remote caps at 20 rows/page)
//   Page 1: SELECT ... LIMIT 1000 OFFSET 0   → 20 rows
//   Page 2: SELECT ... LIMIT 1000 OFFSET 20  → 20 rows
//   ... until clientTop reached or empty batch
//   Output: collected array with $count from first page preserved

function getLimitSlice(limit) {
    if (!limit) return { rows: undefined, offset: 0 }
    const rows = typeof limit.rows === 'object' ? limit.rows?.val : limit.rows
    const offset = typeof limit.offset === 'object' ? limit.offset?.val : limit.offset
    return {
        rows: typeof rows === 'number' ? rows : undefined,
        offset: typeof offset === 'number' ? offset : 0,
    }
}

async function runPagedRemoteQuery(remote, query, { pageSize = 1000, maxPages = 1000 } = {}) {
    const sel = query?.SELECT
    // Single-row reads (e.g. SELECT.one, by-key) bypass paging entirely.
    if (!sel || sel.one) {
        return remote.run(query)
    }

    const { rows: clientTop, offset: clientSkip } = getLimitSlice(sel.limit)
    const needed = typeof clientTop === 'number' ? clientTop : Infinity

    LOG.debug(`Starting paged remote read: need ${needed === Infinity ? 'all' : needed} row(s), pageSize=${pageSize}, offset=${clientSkip || 0}`)

    const collected = []
    let serverCount
    let skip = clientSkip || 0
    let page = 0

    while (collected.length < needed) {
        if (page >= maxPages) {
            LOG.warn(`Delegated paged read hit maxPages=${maxPages} after ${collected.length} rows; stopping`)
            break
        }

        const remaining = needed === Infinity ? pageSize : Math.min(pageSize, needed - collected.length)
        const pageQuery = cds.ql.clone(query)
        pageQuery.SELECT.limit = { rows: { val: remaining }, offset: { val: skip } }

        const batch = await remote.run(pageQuery)

        if (batch == null) return batch

        if (page === 0 && batch && typeof batch === 'object' && '$count' in batch) {
            serverCount = batch.$count
        }

        const arr = Array.isArray(batch) ? batch : []
        if (arr.length === 0) break

        collected.push(...arr)
        skip += arr.length
        page++

        LOG.debug(`Paged remote read page ${page}: requested ${remaining}, got ${arr.length}, collected ${collected.length}/${needed === Infinity ? '∞' : needed}`)

        // If remote returned fewer than we asked for (and we weren't already capped by `needed`),
        // it's still possible the remote is simply exhausted — the next iteration will confirm
        // via an empty batch. We don't early-exit here because Northwind-style caps (20 rows
        // returned on a request for 1000) are indistinguishable from exhaustion without trying again.
    }

    if (serverCount !== undefined) {
        collected.$count = serverCount
    }
    return collected
}

module.exports = { runPagedRemoteQuery }
