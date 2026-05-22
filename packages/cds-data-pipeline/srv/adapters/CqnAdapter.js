const cds = require('../runtime-cds')
const BaseSourceAdapter = require('./BaseSourceAdapter')
const { withRetry } = require('../lib/retry')
const { mergeStaticWhereIntoSelect } = require('../lib/mergeStaticWhereIntoSelect')

/**
 * CQN source adapter. Reads from any CAP-addressable service whose wire
 * protocol is CQN-native (in-process CAP services, `cds.requires` DB-kind
 * services such as `sqlite` / `hana` / `postgres`, CAP-wrapped legacy DBs
 * via `@sap/cds-dbs`).
 *
 * Per ADR 0007 §"Inference rules" (see also `concepts/inference.md`), the
 * adapter serves two read shapes — selected by the presence of
 * `source.query`:
 *
 * - Entity-shape (no `source.query`). Row-preserving copy. Reads
 *   `source.entity` with the pipeline's view mapping applied, paginates
 *   by `.limit(batchSize, skip)`, yields batches.
 *
 * - Query-shape (`source.query` present). Derived / aggregated snapshot.
 *   The user supplies a `source.query(tracker)` closure returning a
 *   SELECT CQN. The adapter runs it once; no batching (the aggregate
 *   result is typically small). `source.batchBy` is reserved for future
 *   partitioning of large aggregate scans.
 */
class CqnAdapter extends BaseSourceAdapter {
    constructor(service, config) {
        super(service, config)
    }

    async *readStream(tracker) {
        if (this.config.source && this.config.source.query) {
            yield* this._readQueryShape(tracker)
            return
        }
        yield* this._readEntityShape(tracker)
    }

    async *_readEntityShape(tracker) {
        const sourceConfig = this.config.source
        const viewMapping = this.config.viewMapping || { isWildcard: true, projectedColumns: [] }
        const delta = this.config.delta || {}

        let baseQuery = SELECT.from(sourceConfig.entity)

        if (!viewMapping.isWildcard && viewMapping.projectedColumns.length > 0) {
            baseQuery = baseQuery.columns(viewMapping.projectedColumns)
        }

        const deltaFilter = this._buildDeltaFilter(delta, tracker)
        if (deltaFilter && Object.keys(deltaFilter).length > 0) {
            baseQuery = baseQuery.where(deltaFilter)
        }

        mergeStaticWhereIntoSelect(baseQuery, viewMapping.staticWhere)

        const batchSize = sourceConfig.batchSize || 1000
        let skip = 0
        let hasMore = true

        while (hasMore) {
            if (sourceConfig.delay) {
                await new Promise(r => setTimeout(r, sourceConfig.delay))
            }

            const query = cds.ql.clone(baseQuery).limit(batchSize, skip)
            const batch = await withRetry(
                () => this.service.run(query),
                this._retryOptions(sourceConfig)
            )

            if (batch && batch.length > 0) {
                yield batch
                skip += batch.length
                hasMore = batch.length >= batchSize
            } else {
                hasMore = false
            }
        }
    }

    async *_readQueryShape(tracker) {
        const sourceConfig = this.config.source

        if (typeof sourceConfig.query !== 'function') {
            throw new Error(
                `CqnAdapter: source.query must be a closure returning a CQN SELECT (query-shape pipelines only).`
            )
        }

        // NOTE: `cds.ql` builders (e.g. `SELECT.from(...)`) are thenable —
        // `await`ing them executes the query against the current cds.context
        // rather than handing back a CQN object. We call the closure without
        // `await` so the result is still a builder (or a plain CQN), then
        // extract the underlying `.SELECT` shape and hand it to
        // `this.service.run()` so the query is dispatched to the configured
        // source service.
        const built = sourceConfig.query(tracker)

        if (!built || typeof built !== 'object') {
            throw new Error(
                `CqnAdapter: source.query(tracker) must return a CQN SELECT (got ${typeof built}).`
            )
        }
        // Defensive — reject explicit non-SELECT CQN statements. Plain CQN
        // objects expose their statement kind on the top-level object (e.g.
        // `{ INSERT: { ... } }`); builders expose them via proxied getters,
        // so this check covers both shapes.
        if (built.INSERT || built.UPDATE || built.DELETE || built.UPSERT) {
            throw new Error(
                `CqnAdapter: source.query(tracker) must return a SELECT CQN; ` +
                `non-SELECT statement rejected.`
            )
        }

        const plain = built.SELECT ? { SELECT: built.SELECT } : built
        if (!plain.SELECT) {
            throw new Error(
                `CqnAdapter: source.query(tracker) must return a SELECT CQN; ` +
                `statement has no .SELECT shape.`
            )
        }

        const rows = await withRetry(
            () => this.service.run(plain),
            this._retryOptions(sourceConfig)
        )

        if (rows && rows.length > 0) yield rows
    }

    _retryOptions(sourceConfig) {
        return {
            maxRetries: sourceConfig.maxRetries || 3,
            baseDelay: sourceConfig.retryDelay || 1000,
            retryOn: (err) => {
                const status = err.status || err.statusCode || err.reason?.status
                return !(typeof status === 'number' && status >= 400 && status < 500)
            },
        }
    }

    _buildDeltaFilter(delta, tracker) {
        const { mode = 'timestamp', field = 'modifiedAt' } = delta
        if (!tracker.lastSync) return {}

        switch (mode) {
            case 'timestamp':
                return { [field]: { '>': new Date(tracker.lastSync).toISOString() } }
            case 'key':
                if (!tracker.lastKey) return {}
                return { [field]: { '>': tracker.lastKey } }
            default:
                return {}
        }
    }
}

module.exports = CqnAdapter
