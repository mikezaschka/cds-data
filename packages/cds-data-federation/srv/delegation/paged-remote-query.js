const cds = require('@sap/cds')
const { withODataEquality, isODataRemote } = require('./odata-equality')
const { cloneQuery } = require('./clone-query')

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

/**
 * The total matching the query's filter, independent of its page window.
 *
 * `SELECT.count` is honoured by remotes inconsistently — the value survives a
 * direct `srv.run()` but not every path the runtime takes to get there — so ask
 * for it explicitly rather than trusting `$count` to be attached. Only ever
 * called when the client did request a count and none came back.
 */
async function fetchRemoteCount(remote, query) {
    try {
        const countQuery = cloneQuery(query, {
            columns: [{ func: 'count', args: [{ val: 1 }], as: 'total' }],
            limit: undefined,
            orderBy: undefined,
            count: false,
            one: true,
        })
        const result = await remote.run(countQuery)
        const total = Array.isArray(result) ? result[0]?.total : result?.total
        return typeof total === 'number' ? total : undefined
    } catch (err) {
        LOG.warn(`Could not determine $count from the remote: ${err.message}`)
        return undefined
    }
}

/**
 * Applies the client's `$top` / `$skip` to a result the remote returned without
 * honouring them, and attaches `$count` when the client asked for one.
 *
 * A remote that dropped the window returned everything matching the filter, so
 * its length *is* the total — no extra round trip needed. Only when the remote
 * did apply the window (fewer rows than asked for) must the total be fetched.
 */
async function applyClientWindow(rows, { remote, query, sel, clientTop, clientSkip }) {
    const windowIgnored = typeof clientTop === 'number' && rows.length > clientTop
    const result = windowIgnored
        ? rows.slice(clientSkip || 0, (clientSkip || 0) + clientTop)
        : rows

    if (windowIgnored) {
        LOG.debug(`CQN-native remote ignored the page window: applied top=${clientTop}, skip=${clientSkip || 0} locally over ${rows.length} row(s)`)
    }

    if (sel.count && !('$count' in result)) {
        result.$count = windowIgnored || typeof clientTop !== 'number'
            ? rows.length
            : await fetchRemoteCount(remote, query)
    }
    return result
}

async function runPagedRemoteQuery(remote, rawQuery, { pageSize = 1000, maxPages = 1000 } = {}) {
    // A consumption view's static `where` may use CXL's `==`, which CAP's
    // CQN→OData translator does not map. Rewrite before anything else, so both
    // the single-row shortcut and the paging loop send a valid $filter.
    const query = withODataEquality(remote, rawQuery)
    const sel = query?.SELECT
    // Single-row reads (e.g. SELECT.one, by-key) bypass paging entirely.
    if (!sel) return remote.run(query)
    if (sel.one) {
        const row = await remote.run(query)
        // A miss is reported differently per protocol: OData answers
        // `undefined`, HCQL an empty string. Passed through, the latter is
        // serialized as `200 {"value":""}` instead of the expected 404.
        if (row === '') return undefined
        return Array.isArray(row) ? row[0] : row
    }

    const { rows: clientTop, offset: clientSkip } = getLimitSlice(sel.limit)
    const needed = typeof clientTop === 'number' ? clientTop : Infinity

    // Auto-paging compensates for a quirk of OData services: a per-request row
    // cap below the requested `$top` (Northwind returns 20 whatever you ask
    // for). CQN-native remotes — hcql, app services, db — have no such cap, so
    // looping buys nothing there and actively harms: when the query still names
    // the local consumption view (which is what keeps HCQL path-expression
    // flattening working), the remote resolves the projection but drops `limit`
    // and `count`. The loop would then re-fetch the same rows until maxPages.
    // Read once, then enforce the client's window here.
    if (!isODataRemote(remote)) {
        LOG.debug('CQN-native remote: running the delegated read unpaged')
        const rows = await remote.run(query)
        if (!Array.isArray(rows)) return rows
        return applyClientWindow(rows, { remote, query, sel, clientTop, clientSkip })
    }

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
        // The total is independent of paging. Request it once: repeated remote
        // counts can be expensive, especially when MCP sets SELECT.count on
        // every CQL query.
        const pageQuery = cloneQuery(query, {
            limit: { rows: { val: remaining }, offset: { val: skip } },
            ...(page > 0 ? { count: false } : {}),
        })

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

        // A remote that ignores `offset` would otherwise hand back the same
        // page forever. When it told us the total up front, trust it.
        if (serverCount !== undefined && collected.length >= serverCount) {
            LOG.debug(`Paged remote read reached the server-reported total of ${serverCount}; stopping`)
            break
        }

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
