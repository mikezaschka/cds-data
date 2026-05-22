const cds = require('../runtime-cds')
const BaseSourceAdapter = require('./BaseSourceAdapter')
const ODataAdapter = require('./ODataAdapter')
const RestAdapter = require('./RestAdapter')
const CqnAdapter = require('./CqnAdapter')

const LOG = cds.log('cds-data-pipeline')

/**
 * Source-adapter factory. Resolution order:
 *
 * 1. `config.source.adapter` — class reference extending `BaseSourceAdapter`.
 *    Users who supply their own adapter class take full control and
 *    skip the kind / remote-kind switch.
 * 2. `config.source.kind` — explicit transport selector
 *    (`'cqn' | 'odata' | 'odata-v2' | 'rest'`). Wins over the remote's
 *    auto-detected kind.
 * 3. `cds.requires.<service>.kind` (or `remote.kind`) — used for
 *    annotation-wired pipelines where the config does not spell out a
 *    transport. Falls back to `ODataAdapter` for unknown values.
 *
 * `source.kind` is a transport-level selector (CQN / OData / REST) and
 * is orthogonal to pipeline shape (entity-shape vs. query-shape);
 * shape-based inference is `CqnAdapter`'s concern, not the factory's.
 */
async function createAdapter(config) {
    const remote = await cds.connect.to(config.source.service)

    // (1) Class-ref override — users who plug in a custom adapter.
    const AdapterClass = config.source && config.source.adapter
    if (typeof AdapterClass === 'function') {
        if (!(AdapterClass.prototype instanceof BaseSourceAdapter) && AdapterClass !== BaseSourceAdapter) {
            LOG.warn(
                `source.adapter for '${config.name}' does not extend BaseSourceAdapter; ` +
                `proceeding, but the contract described in srv/adapters/BaseSourceAdapter.js ` +
                `is still required for the engine to call readStream(tracker) correctly.`
            )
        }
        return new AdapterClass(remote, config)
    }

    // (2) Explicit transport discriminator.
    const explicit = config.source && config.source.kind
    if (explicit === 'cqn') {
        return new CqnAdapter(remote, config)
    }
    if (explicit === 'rest') {
        return new RestAdapter(remote, config)
    }
    if (explicit === 'odata' || explicit === 'odata-v2') {
        return new ODataAdapter(remote, config)
    }

    // (3) Auto-detect from the connected service.
    const kind = remote.options?.kind || remote.kind || 'odata'

    switch (kind) {
        case 'odata':
        case 'odata-v2':
            return new ODataAdapter(remote, config)
        case 'rest':
            return new RestAdapter(remote, config)
        default:
            LOG.debug(`Unknown service kind '${kind}' for '${config.source.service}', falling back to ODataAdapter`)
            return new ODataAdapter(remote, config)
    }
}

module.exports = { createAdapter }
