const cds = require('./runtime-cds')
const { isManagementInspectEnabled } = require('../lib/config-normalizer')

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

async function resolveDefaultRunMode(srv, name) {
    const pipeline = srv.pipelines?.get(name)
    return pipeline?.config?.mode || 'full'
}

async function runPipelineExecute(req, name, data) {
    const { mode } = data
    const trigger = ALLOWED_TRIGGERS.has(data.trigger) ? data.trigger : 'manual'
    const isAsync = data.async === true
    const srv = await cds.connect.to('data-pipeline')
    const runMode = mode || await resolveDefaultRunMode(srv, name)

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
                const srv = await cds.connect.to('data-pipeline')
                return await srv.clearSchedule(name)
            } catch (err) {
                req.error(500, `clearSchedule for '${name}' failed: ${err.message}`)
            }
        })

        this.on('setSchedule', 'Pipelines', async (req) => {
            const { name } = req.params[0]
            const { every, cron, engine } = req.data || {}
            try {
                const srv = await cds.connect.to('data-pipeline')
                return await srv.setSchedule(name, { every, cron, engine })
            } catch (err) {
                req.error(500, `setSchedule for '${name}' failed: ${err.message}`)
            }
        })

        this.on('setOverrides', 'Pipelines', async (req) => {
            const { name } = req.params[0]
            let patch = req.data?.overrides
            try {
                if (typeof patch === 'string') {
                    patch = patch ? JSON.parse(patch) : {}
                }
                if (!patch || typeof patch !== 'object') {
                    return req.error(400, 'setOverrides: overrides must be a JSON object')
                }
                const srv = await cds.connect.to('data-pipeline')
                return JSON.stringify(await srv.setOverrides(name, patch))
            } catch (err) {
                const status = /not overridable|must be/i.test(err.message) ? 400 : 500
                req.error(status, `setOverrides for '${name}' failed: ${err.message}`)
            }
        })

        this.on('clearOverrides', 'Pipelines', async (req) => {
            const { name } = req.params[0]
            const { keys } = req.data || {}
            try {
                const srv = await cds.connect.to('data-pipeline')
                return JSON.stringify(await srv.clearOverrides(name, keys))
            } catch (err) {
                req.error(500, `clearOverrides for '${name}' failed: ${err.message}`)
            }
        })

        this.on('setEnabled', 'Pipelines', async (req) => {
            const { name } = req.params[0]
            const { enabled } = req.data || {}
            try {
                const srv = await cds.connect.to('data-pipeline')
                return JSON.stringify(await srv.setEnabled(name, enabled))
            } catch (err) {
                req.error(500, `setEnabled for '${name}' failed: ${err.message}`)
            }
        })

        this.on('configView', 'Pipelines', async (req) => {
            const { name } = req.params[0]
            try {
                const srv = await cds.connect.to('data-pipeline')
                return JSON.stringify(srv.getConfigView(name))
            } catch (err) {
                req.error(500, `configView for '${name}' failed: ${err.message}`)
            }
        })

        this.on('inspectData', 'Pipelines', async (req) => {
            if (!isManagementInspectEnabled(cds.env.requires)) {
                return req.error(403, 'Pipeline data inspection is disabled (management.inspect: false)')
            }
            const { name } = req.params[0]
            const { side, columnsJson, filters, top, skip } = req.data || {}
            let columns = []
            if (columnsJson) {
                try {
                    columns = JSON.parse(columnsJson)
                } catch {
                    columns = []
                }
            }
            try {
                const srv = await cds.connect.to('data-pipeline')
                const auditCtx = { user: req.user?.id || req.user }
                return await srv.inspectData(name, { side, columns, filters, top, skip, auditCtx })
            } catch (err) {
                req.error(500, `inspectData for '${name}' failed: ${err.message}`)
            }
        })

        this.on('inspectCapabilities', 'Pipelines', async (req) => {
            if (!isManagementInspectEnabled(cds.env.requires)) {
                return JSON.stringify({ source: 'none', target: 'none' })
            }
            const { name } = req.params[0]
            try {
                const srv = await cds.connect.to('data-pipeline')
                return await srv.inspectCapabilities(name)
            } catch (err) {
                req.error(500, `inspectCapabilities for '${name}' failed: ${err.message}`)
            }
        })

        this.on('flowMetadata', 'Pipelines', async (req) => {
            const { name } = req.params[0]
            try {
                const srv = await cds.connect.to('data-pipeline')
                return await srv.getFlowMetadata(name)
            } catch (err) {
                req.error(500, `flowMetadata for '${name}' failed: ${err.message}`)
            }
        })

        this.on('landscapeMetadata', async (req) => {
            try {
                const srv = await cds.connect.to('data-pipeline')
                return await srv.getLandscapeMetadata()
            } catch (err) {
                req.error(500, `landscapeMetadata failed: ${err.message}`)
            }
        })

        this.on('execute', async (req) => {
            const { name } = req.data
            return runPipelineExecute(req, name, req.data)
        })

        this.on('flush', async (req) => {
            const { name } = req.data
            try {
                const srv = await cds.connect.to('data-pipeline')
                await srv.clear(name)
                return `Pipeline '${name}' flushed successfully`
            } catch (err) {
                req.error(500, `Flush '${name}' failed: ${err.message}`)
            }
        })

        this.on('status', async (req) => {
            const { name } = req.data
            try {
                const srv = await cds.connect.to('data-pipeline')
                return await srv.getStatus(name)
            } catch (err) {
                req.error(500, `Status check failed: ${err.message}`)
            }
        })

        await super.init()
    }
}

module.exports = DataPipelineManagementService
