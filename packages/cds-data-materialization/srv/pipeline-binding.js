const cds = require('@sap/cds')
const { assertCqnNativeSource } = require('./annotation-scanner')

const LOG = cds.log('cds-data-materialization')

async function bindMaterializeConfigs(configs) {
    if (!configs || configs.length === 0) return

    let pipelineService
    try {
        pipelineService = await cds.connect.to('data-pipeline')
    } catch (err) {
        throw new Error(
            `@materialize.snapshot requires 'cds-data-pipeline' to be installed. ` +
            `Run: npm install cds-data-pipeline. Original error: ${err.message}`,
            { cause: err }
        )
    }

    for (const config of configs) {
        assertCqnNativeSource(config.sourceService)

        const refresh = config.options.refresh ?? 'full'
        if (refresh !== 'full') {
            throw new Error(
                `@materialize.snapshot on '${config.entityFullName}': only refresh: 'full' is supported in v1`
            )
        }

        await pipelineService.addPipeline({
            name: config.options.name || config.entityName,
            source: {
                kind: 'cqn',
                service: config.sourceService,
                query: config.compiledQuery,
            },
            target: {
                entity: config.entityFullName,
            },
            refresh,
            schedule: config.options.schedule,
            preload: config.options.preload,
        })
    }

    LOG._info && LOG.info(`Bound ${configs.length} @materialize.snapshot config(s) to cds-data-pipeline`)
}

module.exports = { bindMaterializeConfigs }
