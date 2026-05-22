const cds = require('../../runtime-cds')
const BaseTargetAdapter = require('./BaseTargetAdapter')
const DbTargetAdapter = require('./DbTargetAdapter')
const ODataTargetAdapter = require('./ODataTargetAdapter')

const LOG = cds.log('cds-data-pipeline')

/**
 * Target-adapter factory. Resolution order:
 *
 * 1. `config.target.adapter` — class reference extending
 *    `BaseTargetAdapter`. Users who plug in a custom target adapter
 *    take full control and skip the service-based dispatch.
 * 2. `config.target.service` unset or `'db'` → `DbTargetAdapter`
 *    (the local database).
 * 3. `config.target.kind` (`'odata' | 'odata-v2'`) — explicit transport
 *    selector. Wins over the connected service's auto-detected kind.
 * 4. Auto-detect from the connected service's `options.kind`
 *    (`'odata' | 'odata-v2'`) → `ODataTargetAdapter`.
 * 5. Any remaining non-`db` target service without an explicit
 *    `target.adapter` is rejected at registration with a pointer to
 *    the custom-adapter docs. The engine does not silently fall back
 *    to the local DB for un-adapted target services.
 *
 * This replaces the former "target.service accepted, WRITE still goes
 * to db" trap that the move-to-service recipe used to warn about.
 */
async function createTargetAdapter(config) {
    const targetCfg = (config && config.target) || {}

    // (1) Class-ref override — users who plug in a custom target adapter.
    const AdapterClass = targetCfg.adapter
    if (typeof AdapterClass === 'function') {
        if (!(AdapterClass.prototype instanceof BaseTargetAdapter) && AdapterClass !== BaseTargetAdapter) {
            LOG.warn(
                `target.adapter for '${config.name}' does not extend BaseTargetAdapter; ` +
                `proceeding, but the contract described in srv/adapters/targets/BaseTargetAdapter.js ` +
                `is still required for the engine to call writeBatch / truncate / deleteSlice correctly.`
            )
        }
        const service = targetCfg.service ? await cds.connect.to(targetCfg.service) : null
        return new AdapterClass(service, config)
    }

    // (2) Local DB.
    const targetService = targetCfg.service
    if (!targetService || targetService === 'db') {
        return new DbTargetAdapter(null, config)
    }

    // (3) / (4) Secondary SQL database (SQLite, Postgres, …) exposed as CAP `sqlite`/`hana`.
    const remote = await cds.connect.to(targetService)
    const kind = targetCfg.kind || (remote.options && remote.options.kind) || remote.kind

    // Local CQN-native DB targets reuse DbTargetAdapter; `cds.connect.to(service)` resolves
    // the configured datastore (ADR 0004 secondary-DB scenarios; federation entity-cache).
    if (kind === 'sqlite' || kind === 'postgres' || kind === 'hana') {
        return new DbTargetAdapter(null, config)
    }

    if (kind === 'odata' || kind === 'odata-v2') {
        return new ODataTargetAdapter(remote, config)
    }

    // (5) Reject — no built-in target adapter for this transport.
    throw new Error(
        `addPipeline: target.service='${targetService}' (kind='${kind || 'unknown'}') has no built-in ` +
        `target adapter. Either drop target.service to use the default DB adapter, set ` +
        `target.kind='odata' / 'odata-v2' if the remote speaks OData, or supply a target.adapter ` +
        `class extending BaseTargetAdapter. See the custom-adapter guide at docs/guide/targets/custom.md.`
    )
}

module.exports = { createTargetAdapter }
