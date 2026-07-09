const cds = require('../runtime-cds')
const BaseSourceAdapter = require('./BaseSourceAdapter')
const { withRetry } = require('../lib/retry')
const { entityShapeReadStream } = require('./lib/entityShapeReadStream')
const { sourceAdapterRetryOptions } = require('./lib/sourceAdapterRetryOptions')

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
        yield* entityShapeReadStream({
            service: this.service,
            config: this.config,
            tracker,
            buildDeltaFilter: (delta, t) => this._buildDeltaFilter(delta, t),
            stopWhenPartialPage: true,
        })
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
            sourceAdapterRetryOptions(sourceConfig)
        )

        if (rows && rows.length > 0) yield rows
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
