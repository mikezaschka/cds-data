require('@sap/cds')
const cds = global.cds

/** Resolves after the consumer fixture has finished `registerPipelines()` (success or failure). */
async function waitForConsumerFixturePipelines() {
    const p = global.__consumerFixturePipelinesReady
    if (p) await p
}

async function getPipelineService() {
    const srv = await cds.connect.to('data-pipeline')
    if (!srv) throw new Error('DataPipelineService not initialized')
    return srv
}

async function expectThrow(fn) {
    let caught
    try {
        await fn()
    } catch (err) {
        caught = err
    }
    if (!caught) throw new Error('expected function to throw')
    return caught
}

async function readPipelineRow(name) {
    return SELECT.one.from('plugin_data_pipeline_Pipelines').where({ name })
}

/** @param {import('@sap/cds').Service} srv */
async function runPipeline(srv, name, mode = 'delta', trigger = 'manual') {
    await srv.execute(name, { mode, trigger })
}

module.exports = {
    getPipelineService,
    waitForConsumerFixturePipelines,
    expectThrow,
    readPipelineRow,
    runPipeline,
}
