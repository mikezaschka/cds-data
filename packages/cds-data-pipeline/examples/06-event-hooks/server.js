const cds = require('@sap/cds')

// Example 06 layers hooks on every stage of the 5-event envelope. The
// `Shipments` pipeline config mirrors example 01 — the interesting code
// is the hook registrations below.
cds.on('served', async () => {
    const pipelines = await cds.connect.to('DataPipelineService')
    const log = cds.log('example-06')

    await pipelines.addPipeline({
        name: 'Shipments',
        source: { service: 'LogisticsService', entity: 'LogisticsService.Shipments' },
        target: { entity: 'example06.Shipments' },
        delta:  { mode: 'timestamp', field: 'modifiedAt' },
        viewMapping: {
            isWildcard: false,
            projectedColumns: [
                'ID', 'orderId', 'status', 'carrier_code', 'trackingNumber',
                'shippedAt', 'estimatedDelivery', 'actualDelivery',
                'destinationCity', 'destinationCountry', 'modifiedAt'
            ],
            remoteToLocal: { ID: 'id', carrier_code: 'carrierCode' },
        },
    })

    // Run-scope state — Maps keyed by runId so concurrent runs don't
    // clobber each other. Populated in PIPELINE.START, cleared in
    // PIPELINE.DONE.
    const runState = new Map()

    // ── PIPELINE.START ────────────────────────────────────────────────
    // Run-scope setup. Runs once per run, before READ. A rejection here
    // aborts the run; the tracker transitions to `failed` and
    // PIPELINE.DONE still fires with status=failed.
    pipelines.before('PIPELINE.START', 'Shipments', (req) => {
        const { runId, mode, trigger } = req.data
        runState.set(runId, { startedAt: Date.now(), batches: 0, rowsWritten: 0 })
        log.info(`[START] runId=${runId} mode=${mode} trigger=${trigger}`)
    })

    // ── PIPELINE.READ ─────────────────────────────────────────────────
    // Inject or override source config before the default `on` resolves
    // the adapter. Here we demonstrate tweaking the delta watermark for
    // a one-shot replay when an env var is set. Normally you'd leave
    // READ alone; see docs/guide/recipes/event-hooks.md for the wrap-stream
    // pattern that uses `after('PIPELINE.READ', ...)` instead.
    pipelines.before('PIPELINE.READ', 'Shipments', (req) => {
        const replayFrom = process.env.REPLAY_FROM
        if (replayFrom) {
            req.data.config = {
                ...req.data.config,
                delta: { ...req.data.config.delta, lastSync: replayFrom },
            }
            log.info(`[READ] replaying from ${replayFrom}`)
        }
    })

    // ── PIPELINE.MAP_BATCH ────────────────────────────────────────────
    // Filter source rows before MAP applies renames. Drops rows whose
    // `status` is 'pending' — the pipeline materializes only confirmed
    // shipments. A real filter might consult an allow-list service.
    pipelines.before('PIPELINE.MAP_BATCH', 'Shipments', (req) => {
        const before = req.data.sourceRecords.length
        req.data.sourceRecords = req.data.sourceRecords.filter(r => r.status !== 'pending')
        const dropped = before - req.data.sourceRecords.length
        if (dropped) log.info(`[MAP] batch ${req.data.batchIndex}: dropped ${dropped} pending row(s)`)
    })

    // ── PIPELINE.WRITE_BATCH ──────────────────────────────────────────
    // Observe the write result per batch. `_results` is undefined (the
    // default WRITE handler sets `req.data.statistics` rather than
    // returning a value), so we read `req.data` directly.
    pipelines.after('PIPELINE.WRITE_BATCH', 'Shipments', async (_results, req) => {
        const { runId, batchIndex, targetRecords, statistics } = req.data
        const state = runState.get(runId)
        if (state) {
            state.batches += 1
            state.rowsWritten += targetRecords.length
        }

        // Persist a metric row for external inspection. `cds.tx()` adopts
        // the current transaction so this commits with the pipeline run.
        await cds.tx(req).run(INSERT.into('example06.BatchMetrics').entries({
            runId,
            batchIndex,
            recordCount: targetRecords.length,
            writtenAt: new Date().toISOString(),
        }))

        log.info(`[WRITE] run=${runId} batch=${batchIndex} created=${statistics?.created ?? 0} updated=${statistics?.updated ?? 0}`)
    })

    // ── PIPELINE.DONE ─────────────────────────────────────────────────
    // Run summary, regardless of outcome. The default WRITE handler has
    // already committed or rolled back by this point.
    pipelines.after('PIPELINE.DONE', 'Shipments', (_results, req) => {
        const { runId, status, mode, trigger, error, statistics } = req.data
        const state = runState.get(runId)
        const durationMs = state ? Date.now() - state.startedAt : -1
        runState.delete(runId)
        log.info(
            `[DONE] run=${runId} status=${status} mode=${mode} trigger=${trigger} `
            + `duration=${durationMs}ms batches=${state?.batches ?? '?'} `
            + `rows=${state?.rowsWritten ?? '?'} created=${statistics?.created ?? 0} `
            + `updated=${statistics?.updated ?? 0} deleted=${statistics?.deleted ?? 0}`
            + (error ? ` error=${error.message || error}` : '')
        )
    })
})

module.exports = cds.server
