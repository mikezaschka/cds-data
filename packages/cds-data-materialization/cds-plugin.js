const cds = require('@sap/cds')
const { scanAnnotations } = require('./srv/annotation-scanner')
const { bindMaterializeConfigs } = require('./srv/pipeline-binding')

const LOG = cds.log('cds-data-materialization')

let _materializeConfigs = []

cds.on('loaded', (csn) => {
    const { configs } = scanAnnotations(csn)
    _materializeConfigs = configs
    if (_materializeConfigs.length > 0) {
        LOG._info && LOG.info(`Discovered ${_materializeConfigs.length} @materialize.snapshot entities`)
    }
})

cds.once('served', async () => {
    if (_materializeConfigs.length === 0) return

    try {
        await bindMaterializeConfigs(_materializeConfigs)
        LOG._info && LOG.info(`Registered ${_materializeConfigs.length} @materialize.snapshot bindings`)
    } catch (err) {
        LOG._error && LOG.error('Failed to bind @materialize.snapshot configs:', err)
        throw err
    }
})
