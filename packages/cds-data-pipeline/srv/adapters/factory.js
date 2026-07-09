const cds = require('../runtime-cds')
const BaseSourceAdapter = require('./BaseSourceAdapter')
const RemoteCqnAdapter = require('./RemoteCqnAdapter')
const RestAdapter = require('./RestAdapter')
const CqnAdapter = require('./CqnAdapter')

const LOG = cds.log('cds-data-pipeline')

/**
 * Source-adapter factory. Resolution order:
 *
 * 1. `config.source.adapter` — class reference extending `BaseSourceAdapter`.
 * 2. `config.source.kind` — explicit transport selector
 *    (`'cqn' | 'odata' | 'odata-v2' | 'hcql' | 'rest'`).
 * 3. `cds.requires.<service>.kind` (or `remote.kind`) — auto-detected for
 *    annotation-wired pipelines. Unknown remote kinds fall back to
 *    `RemoteCqnAdapter`.
 */
async function createAdapter(config) {
    const remote = await cds.connect.to(config.source.service)

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

    const explicit = config.source && config.source.kind
    if (explicit === 'cqn') {
        return new CqnAdapter(remote, config)
    }
    if (explicit === 'rest') {
        return new RestAdapter(remote, config)
    }
    if (explicit === 'odata' || explicit === 'odata-v2' || explicit === 'hcql') {
        return new RemoteCqnAdapter(remote, config)
    }

    const kind = remote.options?.kind || remote.kind || 'odata'

    switch (kind) {
        case 'odata':
        case 'odata-v2':
        case 'hcql':
            return new RemoteCqnAdapter(remote, config)
        case 'rest':
            return new RestAdapter(remote, config)
        default:
            LOG.debug(
                `Unknown service kind '${kind}' for '${config.source.service}', ` +
                `falling back to RemoteCqnAdapter`
            )
            return new RemoteCqnAdapter(remote, config)
    }
}

module.exports = { createAdapter }
