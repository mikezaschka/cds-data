const cds = require('@sap/cds')

const LOG = cds.log('cds-data-federation')

/**
 * Glue between the `cds-data-federation` annotation surface and the
 * `cds-data-pipeline` engine.
 *
 * For each scanned `@federation.replicate` entity, this module issues a
 * single `addPipeline(...)` call against the engine's `DataPipelineService`.
 * The engine infers entity-shape pipeline intent from the absence of
 * `source.query` (ADR 0007 §"Inference rules"). This is the only place
 * where federation-side knowledge (annotations, view mappings) is
 * translated into the engine's pipeline vocabulary — everything after this
 * point is engine-internal.
 *
 * If the engine is not installed as a peer, we throw a descriptive error
 * pointing the user at the required package.
 */
async function bindReplicateConfigs(configs) {
    if (!configs || configs.length === 0) return

    let pipelineService
    try {
        pipelineService = await cds.connect.to('DataPipelineService')
    } catch (err) {
        throw new Error(
            `@federation.replicate requires 'cds-data-pipeline' to be installed. ` +
            `Run: npm install cds-data-pipeline. Original error: ${err.message}`
        )
    }

    for (const config of configs) {
        await pipelineService.addPipeline({
            name: config.options.name || config.entityName,
            source: {
                service: config.sourceService,
                entity: config.sourceEntity,
                batchSize: config.options.batchSize || 1000,
            },
            target: {
                entity: config.entityFullName,
            },
            mode: config.options.mode || 'delta',
            delta: {
                mode: config.options.delta?.mode || 'timestamp',
                field: config.options.delta?.field || 'modifiedAt',
                ...config.options.delta,
            },
            rest: config.options.rest,
            schedule: config.options.schedule,
            viewMapping: config.viewMapping,
        })
    }

    LOG._info && LOG.info(`Bound ${configs.length} @federation.replicate config(s) to cds-data-pipeline`)
}

module.exports = { bindReplicateConfigs }
