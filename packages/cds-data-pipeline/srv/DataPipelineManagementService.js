const cds = require('./runtime-cds')

// Whitelist of trigger values accepted on the wire. Aligned with the
// `RunTrigger` enum in db/index.cds. Any other value (including `undefined`)
// falls back to `'manual'` so the OData surface cannot be used to write
// arbitrary strings into `PipelineRuns.trigger`.
const ALLOWED_TRIGGERS = new Set(['manual', 'scheduled', 'external', 'event'])

const PIPELINE_RUN_MODES = [
    { code: 'delta', name: 'Delta' },
    { code: 'full', name: 'Full' },
]

const PIPELINE_RUN_TRIGGERS = [
    { code: 'manual', name: 'Manual' },
    { code: 'scheduled', name: 'Scheduled' },
    { code: 'external', name: 'External' },
    { code: 'event', name: 'Event' },
]

async function runPipelineExecute(req, name, data) {
    const { mode } = data
    const trigger = ALLOWED_TRIGGERS.has(data.trigger) ? data.trigger : 'manual'
    const runMode = mode || 'delta'
    const isAsync = data.async === true
    const srv = await cds.connect.to('DataPipelineService')

    try {
        const result = await srv.execute(name, { mode: runMode, trigger, async: isAsync })
        if (isAsync) {
            return `Pipeline '${name}' accepted for async execution (runId=${result.runId})`
        }
        return `Pipeline '${name}' completed successfully`
    } catch (err) {
        req.error(500, `Pipeline '${name}' failed: ${err.message}`)
    }
}

class DataPipelineManagementService extends cds.ApplicationService {
    async init() {
        this.on('READ', 'PipelineRunModes', (req) => {
            const k = req.params?.[0]?.code
            if (k !== undefined) {
                return PIPELINE_RUN_MODES.filter((r) => r.code === k)
            }
            return PIPELINE_RUN_MODES
        })

        this.on('READ', 'PipelineRunTriggers', (req) => {
            const k = req.params?.[0]?.code
            if (k !== undefined) {
                return PIPELINE_RUN_TRIGGERS.filter((r) => r.code === k)
            }
            return PIPELINE_RUN_TRIGGERS
        })

        this.on('start', 'Pipelines', async (req) => {
            const { name } = req.params[0]
            return runPipelineExecute(req, name, req.data)
        })

        this.on('clearSchedule', 'Pipelines', async (req) => {
            const { name } = req.params[0]
            try {
                const srv = await cds.connect.to('DataPipelineService')
                return await srv.clearSchedule(name)
            } catch (err) {
                req.error(500, `clearSchedule for '${name}' failed: ${err.message}`)
            }
        })

        this.on('setSchedule', 'Pipelines', async (req) => {
            const { name } = req.params[0]
            const { every } = req.data
            try {
                const srv = await cds.connect.to('DataPipelineService')
                return await srv.setSchedule(name, { every })
            } catch (err) {
                req.error(500, `setSchedule for '${name}' failed: ${err.message}`)
            }
        })

        this.on('execute', async (req) => {
            const { name } = req.data
            return runPipelineExecute(req, name, req.data)
        })

        this.on('flush', async (req) => {
            const { name } = req.data
            try {
                const srv = await cds.connect.to('DataPipelineService')
                await srv.clear(name)
                return `Pipeline '${name}' flushed successfully`
            } catch (err) {
                req.error(500, `Flush '${name}' failed: ${err.message}`)
            }
        })

        this.on('status', async (req) => {
            const { name } = req.data
            try {
                const srv = await cds.connect.to('DataPipelineService')
                return await srv.getStatus(name)
            } catch (err) {
                req.error(500, `Status check failed: ${err.message}`)
            }
        })

        await super.init()
    }
}

module.exports = DataPipelineManagementService
