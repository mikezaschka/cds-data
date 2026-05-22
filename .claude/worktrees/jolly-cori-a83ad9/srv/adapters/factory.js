const cds = require('@sap/cds')
const ODataAdapter = require('./ODataAdapter')
const RestAdapter = require('./RestAdapter')

const LOG = cds.log('cds-data-federation')

async function createAdapter(config) {
    const remote = await cds.connect.to(config.source.service)
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
