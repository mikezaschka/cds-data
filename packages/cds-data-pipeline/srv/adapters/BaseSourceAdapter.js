const cds = require('../runtime-cds')

/**
 * Abstract source adapter. A source adapter is the protocol-specific
 * implementation of the `PIPELINE.READ` phase: given a tracker row it
 * yields batches of source records for the engine's MAP_BATCH +
 * WRITE_BATCH loop.
 *
 * ## Contract
 *
 * Subclasses must implement `readStream(tracker)` as an async generator
 * (or a method returning an async iterable). Each yielded value is an
 * array of plain-object records in source shape — renames and
 * projections happen downstream in `PIPELINE.MAP_BATCH`, not here.
 *
 * The generator is consumed exactly once per pipeline run. Respect
 * backpressure: the engine awaits each batch before requesting the next.
 *
 * ## Tracker
 *
 * `tracker` is the current `plugin_data_pipeline_Pipelines` row for this
 * pipeline. The fields an adapter is expected to honour are:
 *
 * | Field      | Meaning                                                      |
 * |------------|--------------------------------------------------------------|
 * | `lastSync` | ISO timestamp of the last successful run (null on first run)|
 * | `lastKey`  | Highest primary-key value seen in the last run (key delta)  |
 * | `status`   | Lifecycle marker (`idle` / `running` / `failed`)            |
 *
 * Delta filtering is the adapter's responsibility: translate
 * `config.delta` + the tracker into a source-side predicate (OData
 * `$filter`, REST query param, CQN WHERE, …). Query-shape pipelines
 * (`config.source.query` present) sidestep delta entirely — the user's
 * closure receives `tracker` and decides whether to gate on it.
 *
 * ## Config
 *
 * Adapters receive the full normalized pipeline config. The fields an
 * adapter typically reads:
 *
 * - `config.source.entity` / `config.source.query` / `config.rest.path`
 * - `config.source.batchSize`, `config.source.delay`, `config.source.maxRetries`
 * - `config.delta.mode`, `config.delta.field`, and transport-specific delta hints
 * - `config.viewMapping.projectedColumns` / `config.viewMapping.isWildcard`
 *
 * Adapters must not mutate `config`.
 *
 * ## Capabilities (optional)
 *
 * Override `capabilities()` to advertise which delta modes and read
 * shapes the adapter supports. `DataPipelineService._validateConfig` is
 * expected to consult these in a future pass; unadvertised features are
 * assumed unsupported. Returning the defaults below keeps behaviour
 * unchanged from the pre-capabilities era.
 *
 * ## Registering a custom adapter
 *
 * Two escape hatches in `srv/adapters/factory.js`:
 *
 * 1. Class-ref override: pass `source.adapter: MyAdapter` on
 *    `addPipeline(...)` — the factory instantiates it directly and
 *    skips the kind / remote-kind switch.
 * 2. Transport discriminator: set `source.kind: 'cqn' | 'odata' |
 *    'odata-v2' | 'rest'`, or rely on `cds.requires.<svc>.kind` for
 *    annotation-wired pipelines.
 *
 * See `docs/guide/sources/custom.md` for a worked example.
 */
class BaseSourceAdapter {
    /**
     * @param {object} service - The connected CAP service proxy (result
     *   of `cds.connect.to(config.source.service)`).
     * @param {object} config - The normalized pipeline config.
     */
    constructor(service, config) {
        this.service = service
        this.config = config
        this.LOG = cds.log('cds-data-pipeline')
    }

    /**
     * Yields batches of source records as an async generator.
     *
     * @param {object} _tracker - `Pipelines` row: `{ lastSync, lastKey, status, ... }`.
     * @yields {object[]} Array of records per batch.
     */
    // eslint-disable-next-line require-yield, no-unused-vars
    async *readStream(_tracker) {
        throw new Error('readStream() not implemented')
    }

    /**
     * Advertise which features the adapter supports. Return a strict
     * subset of the shape below; omitted keys default to `false`.
     *
     * @returns {{
     *   entityShape: boolean,
     *   queryShape: boolean,
     *   deltaTimestamp: boolean,
     *   deltaKey: boolean,
     *   deltaDatetimeFields: boolean
     * }}
     */
    capabilities() {
        return {
            entityShape: true,
            queryShape: false,
            deltaTimestamp: false,
            deltaKey: false,
            deltaDatetimeFields: false,
        }
    }
}

module.exports = BaseSourceAdapter
