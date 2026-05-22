const cds = require('../../runtime-cds')

/**
 * Abstract target adapter. A target adapter is the protocol-specific
 * implementation of the `PIPELINE.WRITE_BATCH` phase (and the pre-write
 * clearing that full / partial refresh runs require). It isolates every
 * engine call that used to hard-code `cds.connect.to('db')` behind a
 * capability-checked interface.
 *
 * ## Contract
 *
 * Subclasses implement three write primitives and one metadata method:
 *
 * | Method                                | When the engine calls it                                      |
 * |---------------------------------------|---------------------------------------------------------------|
 * | `writeBatch(records, { mode, target })` | Once per MAP_BATCH-produced batch                           |
 * | `truncate(target)`                    | `mode: 'full'` pre-sync, and `refresh: 'full'` materialize  |
 * | `deleteSlice(target, predicate)`      | `refresh: { mode: 'partial', slice }` materialize           |
 * | `capabilities()`                      | Once at registration, before validation                     |
 *
 * `mode` on `writeBatch` is one of:
 *
 * - `'upsert'`  — entity-shape (row-preserving); idempotent per key.
 * - `'snapshot'` — query-shape INSERT after the engine has already
 *   cleared the slice via `truncate` / `deleteSlice`.
 *
 * `target` is the normalized `config.target` object (`{ service?, entity }`).
 *
 * ## Capabilities
 *
 * `capabilities()` gates `DataPipelineService._validateConfig` rows 6-8:
 *
 * | Capability             | Required when                                                    |
 * |------------------------|------------------------------------------------------------------|
 * | `keyAddressableUpsert` | `mode: 'delta'` (entity-shape UPSERT per key)                   |
 * | `truncate`             | `mode: 'full'` **or** `refresh: 'full'`                         |
 * | `batchDelete`          | `refresh: { mode: 'partial', slice }`                           |
 * | `batchInsert`          | `source.query` (query-shape snapshot writes)                    |
 *
 * Omitted keys default to `false`. An adapter that cannot honour one of
 * the primitives should also omit the corresponding capability so the
 * engine rejects incompatible pipelines at registration instead of at
 * first run.
 *
 * ## Built-in adapters
 *
 * Two ship out of the box:
 *
 * - `DbTargetAdapter` — resolved when `target.service` is unset or
 *   `'db'`. Translates CQN to the local database.
 * - `ODataTargetAdapter` — resolved when `target.kind` is
 *   `'odata' / 'odata-v2'`, or when the connected remote service
 *   advertises that kind via `service.options.kind`. Routes writes
 *   through CAP's remote runtime; does per-row DELETE for truncate /
 *   deleteSlice.
 *
 * ## Registering a custom adapter
 *
 * Escape hatches in `srv/adapters/targets/factory.js`:
 *
 * 1. Class-ref override: pass `target.adapter: MyTargetAdapter` on
 *    `addPipeline(...)` — the factory instantiates it directly and
 *    skips the service-based dispatch.
 * 2. Service discriminator: any `target.service` whose kind is not
 *    `'db'` or `'odata' / 'odata-v2'` requires an explicit
 *    `target.adapter`; the factory rejects unresolved target services
 *    at registration time.
 *
 * See `docs/guide/targets/custom.md` for worked examples.
 */
class BaseTargetAdapter {
    /**
     * @param {object|null} service - Optional connected CAP service
     *   proxy for the target. `DbTargetAdapter` lazily connects to
     *   `'db'`; custom adapters receive whatever the factory resolved.
     * @param {object} config - The normalized pipeline config.
     */
    constructor(service, config) {
        this.service = service
        this.config = config
        this.LOG = cds.log('cds-data-pipeline')
    }

    /**
     * Write one batch of target-shape records.
     *
     * @param {object[]} _records - Target-shape records from PIPELINE.MAP_BATCH.
     * @param {{ mode: 'upsert' | 'snapshot', target: object }} _ctx
     * @returns {Promise<{ created?: number, updated?: number, deleted?: number }>}
     *   Statistics for this batch. The engine accumulates per-run totals.
     */
    // eslint-disable-next-line no-unused-vars
    async writeBatch(_records, _ctx) {
        throw new Error('writeBatch() not implemented')
    }

    /**
     * Clear the whole target. Used for `mode: 'full'` entity-shape
     * resyncs and for `refresh: 'full'` materialize pipelines.
     */
    // eslint-disable-next-line no-unused-vars
    async truncate(_target) {
        throw new Error('truncate() not implemented')
    }

    /**
     * Delete rows matching a CQN predicate. Used for partial-refresh
     * materialize pipelines (`refresh: { mode: 'partial', slice }`).
     */
    // eslint-disable-next-line no-unused-vars
    async deleteSlice(_target, _predicate) {
        throw new Error('deleteSlice() not implemented')
    }

    /**
     * Advertise what the adapter can do. Omitted keys default to
     * `false`. See the class JSDoc for the gating matrix.
     *
     * @returns {{
     *   batchInsert: boolean,
     *   keyAddressableUpsert: boolean,
     *   batchDelete: boolean,
     *   truncate: boolean
     * }}
     */
    capabilities() {
        return {
            batchInsert: false,
            keyAddressableUpsert: false,
            batchDelete: false,
            truncate: false,
        }
    }
}

module.exports = BaseTargetAdapter
