const cds = require('../runtime-cds')
const { createAdapter } = require('../adapters/factory')
const { createTargetAdapter } = require('../adapters/targets/factory')
const { fetchEventKeyBatch } = require('./eventKeyRead')
const { rowsAffected } = require('./rowsAffected')
const { formatScheduleLabel } = require('./inspectData')
const {
    serializeBaseConfig,
    parseOverridesJson,
    applyOverrides,
} = require('./overrides')

const LOG = cds.log('cds-data-pipeline')
const PIPELINES = 'plugin_data_pipeline_Pipelines'
const RUNS = 'plugin_data_pipeline_PipelineRuns'

/**
 * Per-pipeline execution engine.
 *
 * Drives the pipeline by constructing `cds.Request` instances and
 * dispatching them through the parent `DataPipelineService`. Five events
 * bracket each run: `PIPELINE.START`, `PIPELINE.READ`, `PIPELINE.MAP`,
 * `PIPELINE.WRITE`, `PIPELINE.DONE`. Default per-phase handlers for
 * READ / MAP / WRITE are registered on the parent service and
 * invoked via its internal router; user-facing hooks (`before.PIPELINE.MAP`,
 * `after.PIPELINE.DONE`, ...) compose through CAP's native handler chain.
 *
 * Config layering (see `overrides.js`):
 *   - `baseConfig` — coded normalized config from `addPipeline`
 *   - `overrides`  — persisted JSON delta (survives restart)
 *   - `config`     — effective = applyOverrides(baseConfig, overrides)
 */
class Pipeline {
    constructor(name, config, srv) {
        this.name = name
        this.baseConfig = config
        this.overrides = {}
        this.config = applyOverrides(config, {})
        this.srv = srv
    }

    async init() {
        this.srv.registerDefault('PIPELINE.READ', this.name, (req) => this._defaultReadHandler(req))
        this.srv.registerDefault('PIPELINE.MAP', this.name, (req) => this._defaultMapHandler(req))
        this.srv.registerDefault('PIPELINE.WRITE', this.name, (req) => this._defaultWriteHandler(req))

        // Resolve the read adapter once at registration. Lets the service
        // compose an adapter-aware startup log line (ADR 0007
        // §"Observability compensation") and avoids re-doing the
        // `cds.connect.to(source.service)` lookup on every READ phase.
        // `cds.connect.to` returns an in-process service proxy; no network
        // traffic is issued until the first `.run()`.
        // Adapters use structural source/target (from base); overridable
        // knobs (batchSize, retry, delta, mode) are read from `this.config`
        // per run / per request.
        this.adapter = await createAdapter(this.baseConfig)

        // Target adapter is symmetric: one instance per pipeline, resolved
        // once, consulted by every WRITE-phase and pre-write path. The
        // default `DbTargetAdapter` lazily connects to 'db' so no network
        // / DB activity happens until the first batch lands.
        this.targetAdapter = await createTargetAdapter(this.baseConfig)

        // Capability-based validation (ADR-0007 rows 6-8) — must happen
        // after the target adapter is resolved and before any tracker
        // writes, so an incompatible config throws cleanly at
        // registration rather than halfway through the first run.
        if (typeof this.srv._validateTargetCapabilities === 'function') {
            this.srv._validateTargetCapabilities(this.baseConfig, this.targetAdapter)
        }

        // ADR 0012 — memoize multi-source state once. `origin` is the
        // label stamped into the target's `source` key column; the
        // aspect test recognizes consumers that mixed in
        // `plugin.data_pipeline.sourced` *and* consumers who declared a
        // `key source : String(N)` element directly (the element-level
        // shape is what matters at write time).
        this.origin = (this.baseConfig.source && this.baseConfig.source.origin) || null
        this.hasSourceAspect = this._targetHasSourceAspect()

        await this._ensureTracker()
        LOG._info && LOG.info(`Initialized pipeline: ${this.name}`)
    }

    /**
     * Recompute `this.config` from base + overrides. Rebinds adapters so
     * per-run knobs (batchSize, delta, flags, …) read the effective config.
     */
    applyLoadedOverrides(overrides) {
        this.overrides = overrides && typeof overrides === 'object' ? overrides : {}
        this.config = applyOverrides(this.baseConfig, this.overrides)
        if (this.adapter) this.adapter.config = this.config
        if (this.targetAdapter) this.targetAdapter.config = this.config
    }

    /**
     * True when the target entity exposes a `source` element marked as a
     * primary key — the structural fingerprint of the
     * `plugin.data_pipeline.sourced` aspect (ADR 0012). Checks the
     * compiled CDS model rather than the aspect name so consumers who
     * declared `key source : String(100)` inline (without the import)
     * keep working.
     */
    _targetHasSourceAspect() {
        const entityName = this.baseConfig.target && this.baseConfig.target.entity
        const def = entityName && cds.model && cds.model.definitions && cds.model.definitions[entityName]
        const el = def && def.elements && def.elements.source
        return !!(el && el.key === true)
    }

    // ─── Execution ──────────────────────────────────────────────────────────────

    /**
     * Execute the pipeline. Internal entry point — public callers use
     * `DataPipelineService#execute(name, opts?)`, which mints the runId
     * and threads it into here.
     *
     *   @param {string} [mode='delta']
     *   @param {string} [trigger='manual']
     *   @param {string} [runId]   caller-supplied correlation id; minted
     *                             here if omitted so scheduler / TICK
     *                             callers work unchanged.
     *   @param {null|{ event: object }} [eventPayload]  ADR 0013: structured
     *                             `event` object — micro-run; skips batch
     *                             `readStream` and (on success) skips
     *                             `Pipelines.lastSync` / cumulative stats.
     *   @returns {Promise<{ runId, status, statistics }>}
     */
    async _run(mode = 'delta', trigger = 'manual', runId, eventPayload = null) {
        const affected = await UPDATE(PIPELINES)
            .set({ status: 'running' })
            .where({ name: this.name, status: { '!=': 'running' } })

        // `UPDATE` resolves to a number on CDS 9 but to a `{ affected }` shape
        // on CDS 10; normalize so the concurrency guard works on both.
        if (rowsAffected(affected) === 0) {
            LOG.warn(`Pipeline '${this.name}' already running, skipping.`)
            return { runId, status: 'skipped', statistics: { created: 0, updated: 0, deleted: 0 } }
        }

        const effectiveRunId = runId || cds.utils.uuid()
        this.currentRunId = effectiveRunId
        const startTime = new Date().toISOString()
        let tracker
        try {
            await INSERT.into(RUNS).entries({
                ID: effectiveRunId,
                pipeline_name: this.name,
                status: 'running',
                startTime,
                trigger,
                mode,
                origin: this.origin || null,
                statistics_created: 0,
                statistics_updated: 0,
                statistics_deleted: 0,
            })

            tracker = await this._getTracker()

            // ── PIPELINE.START ──
            const startPayload = {
                runId: effectiveRunId,
                mode,
                trigger,
                config: this.config,
                tracker,
            }
            if (eventPayload && eventPayload.event) {
                startPayload.event = eventPayload.event
            }
            await this._dispatchLifecycle('PIPELINE.START', startPayload)

            let stats
            if (eventPayload && eventPayload.event) {
                stats = await this._executeEventPayload(eventPayload.event)
            } else {
                stats = mode === 'full'
                    ? await this._fullSync()
                    : await this._deltaSync()
            }

            const endTime = new Date().toISOString()

            await UPDATE(RUNS).set({
                status: 'completed',
                endTime,
                statistics_created: stats.created,
                statistics_updated: stats.updated,
                statistics_deleted: stats.deleted,
            }).where({ ID: effectiveRunId })

            const pipelineSuccessPatch = { status: 'idle' }
            if (!(eventPayload && eventPayload.event)) {
                pipelineSuccessPatch.lastSync = endTime
                pipelineSuccessPatch.statistics_created = { '+=': stats.created }
                pipelineSuccessPatch.statistics_updated = { '+=': stats.updated }
                pipelineSuccessPatch.statistics_deleted = { '+=': stats.deleted }
            }
            await UPDATE(PIPELINES).set(pipelineSuccessPatch).where({ name: this.name })

            // ── PIPELINE.DONE (success) ──
            await this._dispatchLifecycle('PIPELINE.DONE', {
                runId: effectiveRunId,
                status: 'completed',
                mode,
                trigger,
                startTime,
                endTime,
                statistics: stats,
            })

            return { runId: effectiveRunId, status: 'completed', statistics: stats }

        } catch (err) {
            LOG._error && LOG.error(`Pipeline failed for ${this.name}:`, err)

            const endTime = new Date().toISOString()
            const zeroStats = { created: 0, updated: 0, deleted: 0 }

            try {
                await UPDATE(RUNS).set({
                    status: 'failed',
                    endTime,
                    error: JSON.stringify({ message: err.message }),
                }).where({ ID: effectiveRunId })

                await UPDATE(PIPELINES).set({
                    status: 'failed',
                    errorCount: { '+=': 1 },
                    lastError: err.message,
                }).where({ name: this.name })
            } catch (trackerErr) {
                LOG._error && LOG.error(`Failed to record failure for ${this.name}:`, trackerErr)
            }

            // ── PIPELINE.DONE (failure) — dispatched before re-throw so
            // observers always see a completion signal. Dispatch errors
            // must never mask the original pipeline error.
            await this._dispatchLifecycle('PIPELINE.DONE', {
                runId: effectiveRunId,
                status: 'failed',
                mode,
                trigger,
                startTime,
                endTime,
                statistics: zeroStats,
                error: { message: err.message },
            })

            throw err
        } finally {
            this.currentRunId = null
        }
    }

    /**
     * Dispatch a START / DONE lifecycle event through the parent service.
     * Swallows and logs dispatch errors so a misbehaving observer can
     * never mask the pipeline's own outcome (important on the failure
     * branch of `_run`, where the real error must still surface).
     */
    async _dispatchLifecycle(event, data) {
        try {
            const req = this._makeReq(event, data)
            await this.srv.dispatch(req)
        } catch (err) {
            LOG._error && LOG.error(`${event} handler for '${this.name}' failed:`, err)
        }
    }

    async _fullSync() {
        // Query-shape pipelines declare their refresh scope on the config
        // (`refresh: 'full'` wipes the target; `refresh: { mode: 'partial',
        // slice }` scopes the DELETE). `_prepareMaterializeTarget` runs
        // inside `_deltaSync` and honours that contract — an unconditional
        // wipe here would clobber rows outside the slice on a
        // partial-refresh pipeline.
        //
        // ADR 0012: when the target uses the `sourced` aspect and this
        // pipeline has an `origin` label, scope the pre-sync wipe to its
        // own origin so sibling pipelines' rows survive `mode: 'full'`.
        if (!this._isSnapshotWrite()) {
            await this._clearTargetForSync()
        }

        await UPDATE(PIPELINES)
            .set({ lastSync: null, lastKey: null })
            .where({ name: this.name })

        return this._deltaSync()
    }

    /**
     * Clear the target in preparation for a full re-sync. ADR 0012 scopes
     * the DELETE to `source = <origin>` when the target mixes in the
     * `sourced` aspect and this pipeline carries an origin label, so N
     * sibling pipelines can share one target table without wiping each
     * other out. Falls back to `truncate()` for legacy single-origin
     * targets.
     */
    async _clearTargetForSync() {
        if (this.hasSourceAspect && this.origin) {
            await this.targetAdapter.deleteSlice(this.config.target, { source: this.origin })
            LOG._info && LOG.info(
                `Pipeline '${this.name}': full-sync cleared target scope source='${this.origin}'`
            )
            return
        }
        await this.targetAdapter.truncate(this.config.target)
    }

    /**
     * True when this pipeline rebuilds the target from a query-shape read
     * (aggregated / derived snapshot). In that case the WRITE phase rebuilds
     * the target (full refresh → DELETE + INSERT; partial refresh → scoped
     * DELETE + INSERT) instead of UPSERTing row-by-row. Driven by the
     * presence of `source.query`, per ADR 0007 §"Inference rules".
     */
    _isSnapshotWrite() {
        return !!(this.config.source && this.config.source.query)
    }

    /**
     * JSON.stringify replacer that substitutes function values with a
     * marker string. Needed because `source.query` / `refresh.slice` are
     * closures on the live config object but the tracker row stores the
     * config as JSON. The marker preserves the fact that a closure was
     * supplied without exposing its body.
     */
    _safeReplacer(_key, value) {
        return typeof value === 'function' ? '[Function]' : value
    }

    async _deltaSync() {
        await this._clearEntityCacheBeforeRefresh()

        // ── READ phase ──
        const readReq = this._makeReq('PIPELINE.READ', {
            config: this.config,
            source: this.config.source,
            target: this.config.target,
        })
        await this.srv.dispatch(readReq)

        const sourceStream = readReq.data.sourceStream
        if (!sourceStream) {
            LOG.warn(`No source stream produced for '${this.name}'`)
            return { created: 0, updated: 0, deleted: 0 }
        }

        return this._processBatchesFromStream(sourceStream)
    }

    /**
     * Federation entity-cache — before reading from remote, truncate the cache table
     * in the current tenant DB / SQLite file so stale rows disappear when the OData
     * read returns fewer keys (ADR 0010).
     */
    async _clearEntityCacheBeforeRefresh() {
        const flags = this.config.flags || {}
        if (!flags.entityCachePerTenantDb && !flags.entityCacheRefreshTruncate) return
        try {
            await this.targetAdapter.truncate(this.config.target)
        } catch (err) {
            const msg = err && err.message ? String(err.message) : ''
            if (msg.includes('no such table')) {
                LOG.debug(`Pipeline '${this.name}': entity-cache table not yet created — skip truncate`)
                return
            }
            throw err
        }
        const tenantId =
            (cds.context && cds.context.tenant) ??
            (cds.context && cds.context.user && cds.context.user.tenant) ??
            ''
        LOG.debug(
            `Pipeline '${this.name}': truncated entity-cache table` +
                (tenantId ? ` (tenant …${String(tenantId).slice(-12)})` : ''),
        )
    }

    /**
     * ADR 0013 — event micro-run: delete by source-shaped keys (remote names),
     * mapped to local key columns, optional `sourced` origin.
     */
    async _eventDeleteByKeys(keys) {
        if (!this.targetAdapter || typeof this.targetAdapter.deleteSlice !== 'function') {
            throw new Error(
                `Pipeline '${this.name}': event action delete is not supported for this target adapter`
            )
        }
        const viewMapping = this.config.viewMapping || { remoteToLocal: {} }
        const { remoteToLocal } = viewMapping
        const localPredicate = {}
        for (const [k, v] of Object.entries(keys)) {
            const lk = (remoteToLocal && remoteToLocal[k]) || k
            localPredicate[lk] = v
        }
        if (this.hasSourceAspect && this.origin) {
            localPredicate.source = this.origin
        }
        await this.targetAdapter.deleteSlice(this.config.target, localPredicate)
        return { created: 0, updated: 0, deleted: 1 }
    }

    /**
     * ADR 0013 — `event` object from `DataPipelineService.execute` / `executeEvent`.
     */
    async _executeEventPayload(event) {
        if (!event || typeof event.read !== 'string') {
            throw new Error(`Pipeline '${this.name}': execute event requires event.read ('key' | 'payload')`)
        }
        const action = event.action || 'upsert'
        if (action === 'delete') {
            if (event.read !== 'key' || !event.keys) {
                throw new Error(
                    `Pipeline '${this.name}': event action delete requires read: 'key' and event.keys (ADR 0013)`
                )
            }
            return this._eventDeleteByKeys(event.keys)
        }
        if (action !== 'upsert') {
            throw new Error(`Pipeline '${this.name}': unknown event.action '${action}'`)
        }
        if (this._isSnapshotWrite()) {
            throw new Error(
                `Pipeline '${this.name}': event execute is not supported for query-shape (materialize) pipelines in v1 (ADR 0013)`
            )
        }

        let sourceStream
        if (event.read === 'payload') {
            const raw = event.payload
            if (raw === undefined || raw === null) {
                return { created: 0, updated: 0, deleted: 0 }
            }
            const rows = Array.isArray(raw) ? raw : [raw]
            sourceStream = (async function* () {
                if (rows.length) yield rows
            })()
        } else if (event.read === 'key') {
            if (!event.keys || typeof event.keys !== 'object' || Object.keys(event.keys).length === 0) {
                throw new Error(
                    `Pipeline '${this.name}': event read:key requires a non-empty event.keys object (ADR 0013)`
                )
            }
            if (this.config.source && this.config.source.adapter) {
                throw new Error(
                    `Pipeline '${this.name}': event read:key with source.adapter custom class is not supported in v1 (ADR 0013)`
                )
            }
            const service = await cds.connect.to(this.config.source.service)
            const batch = await fetchEventKeyBatch(service, this.config, event.keys)
            sourceStream = (async function* () {
                if (batch.length) yield batch
            })()
        } else {
            throw new Error(
                `Pipeline '${this.name}': event.read must be 'key' or 'payload' (got '${event.read}')`
            )
        }

        return this._processBatchesFromStream(sourceStream)
    }

    /**
     * Shared MAP/WRITE loop for any async-iterable of source batches
     * (batch `_deltaSync` and ADR 0013 event upserts).
     */
    async _processBatchesFromStream(sourceStream) {
        const stats = { created: 0, updated: 0, deleted: 0 }

        // ── Snapshot pre-write: clear the snapshot slice atomically with
        //    the subsequent INSERT batches via `cds.tx`. A crash after the
        //    tx rolls back leaves the previous snapshot intact (ADR 0007).
        const runBody = async () => {
            if (this._isSnapshotWrite()) {
                await this._prepareMaterializeTarget()
            }

            let batchIndex = 0
            for await (const batch of sourceStream) {
                const mapReq = this._makeReq('PIPELINE.MAP', {
                    batchIndex,
                    config: this.config,
                    source: this.config.source,
                    target: this.config.target,
                    sourceRecords: batch,
                    targetRecords: [],
                })
                await this.srv.dispatch(mapReq)

                const records = mapReq.data.targetRecords
                if (!records || records.length === 0) {
                    batchIndex += 1
                    continue
                }

                const writeReq = this._makeReq('PIPELINE.WRITE', {
                    batchIndex,
                    config: this.config,
                    target: this.config.target,
                    targetRecords: records,
                    statistics: { created: 0, updated: 0, deleted: 0 },
                })
                await this.srv.dispatch(writeReq)

                const s = writeReq.data.statistics || {}
                stats.created += s.created || 0
                stats.updated += s.updated || 0
                stats.deleted += s.deleted || 0
                batchIndex += 1
            }
        }

        if (this._isSnapshotWrite()) {
            await cds.tx(runBody)
        } else {
            await runBody()
        }

        LOG._info && LOG.info(
            `Pipeline '${this.name}' processed ${stats.created} created, ${stats.updated} updated, ${stats.deleted} deleted (batch totals)`
        )
        return stats
    }

    /**
     * Clear the materialize target before the batch-insert loop.
     *
     * - `refresh: 'full'` (default): DELETE everything from the target entity.
     *   Not crash-safe beyond the surrounding tx — an aborted run rolls back
     *   and leaves the previous snapshot intact.
     * - `refresh` shaped as `{ mode: 'partial', slice }`: DELETE rows matching
     *   the slice predicate derived from the user-supplied closure. The slice
     *   predicate is mandatory — the adapter does not attempt to infer one
     *   from the source query's WHERE clause (it's not mechanically reliable
     *   across aggregates).
     */
    async _prepareMaterializeTarget() {
        const target = this.config.target
        const refresh = this.config.refresh

        if (refresh && typeof refresh === 'object' && refresh.mode === 'partial') {
            if (typeof refresh.slice !== 'function') {
                LOG.warn(
                    `Pipeline '${this.name}': refresh.mode='partial' requires refresh.slice(tracker). ` +
                    `Falling back to full refresh.`
                )
                await this.targetAdapter.truncate(target)
                return
            }
            const tracker = await this._getTracker()
            const predicate = await refresh.slice(tracker)
            await this.targetAdapter.deleteSlice(target, predicate)
            return
        }

        await this.targetAdapter.truncate(target)
    }

    /**
     * Construct a request for the pipeline. Sets `req.reply` before dispatch
     * to force interceptor-chain semantics on CAP's `on` handlers (without
     * it, CAP runs `on` handlers in parallel rather than as a chain with
     * `next()` fall-through). Path uses the plugin convention
     * `${srv.name}.${pipelineName}` so user-registered
     * `before/after(event, pipelineName, handler)` hooks match via CAP's
     * native path matcher. `runId` is carried on every payload so consumers
     * can correlate across START / READ / MAP / WRITE / DONE.
     */
    _makeReq(event, data) {
        const req = new cds.Request({
            event,
            path: `${this.srv.name}.${this.name}`,
            data: { pipeline: this.name, runId: this.currentRunId, ...data },
        })
        req.reply = (x) => { req.results = x }
        return req
    }

    // ─── Default handlers ───────────────────────────────────────────────────────

    async _defaultReadHandler(req) {
        const config = req.data.config || this.config
        const tracker = await this._getTracker()
        // Reuse the adapter resolved during `init()` when the caller ran
        // with the pipeline's own config (the common case). For callers
        // that override `req.data.config` we resolve a fresh adapter so
        // their override takes effect.
        const adapter = config === this.config ? this.adapter : await createAdapter(config)
        req.data.sourceStream = adapter.readStream(tracker)
    }

    async _defaultMapHandler(req) {
        const records = req.data.sourceRecords
        const config = req.data.config || this.config
        const viewMapping = config.viewMapping || { remoteToLocal: {} }
        const { remoteToLocal } = viewMapping
        const hasRenames = remoteToLocal && Object.keys(remoteToLocal).length > 0

        const mapped = hasRenames
            ? records.map(rec => {
                const out = {}
                for (const [key, val] of Object.entries(rec)) {
                    out[remoteToLocal[key] || key] = val
                }
                return out
            })
            : records.map(rec => ({ ...rec }))

        this._stampOrigin(mapped)
        req.data.targetRecords = mapped
    }

    async _defaultWriteHandler(req) {
        const records = req.data.targetRecords
        const config = req.data.config || this.config
        const target = req.data.target || config.target

        // ADR 0012 belt-and-braces: re-stamp `source = origin` right
        // before WRITE so a consumer-supplied `on('PIPELINE.MAP')` that
        // forgot the stamp still produces valid compound keys.
        this._stampOrigin(records)

        // Query-shape pipelines rebuild the (slice of the) snapshot from
        // scratch each run — `_prepareMaterializeTarget()` has already
        // cleared the target inside the pipeline's tx, so an INSERT is
        // both sufficient and correct. For entity-shape pipelines we keep
        // UPSERT for idempotency across re-runs (Req 4.4.4).
        const mode = (config.source && config.source.query) ? 'snapshot' : 'upsert'

        const stats = await this.targetAdapter.writeBatch(records, { mode, target })

        req.data.statistics = {
            created: (stats && stats.created) || 0,
            updated: (stats && stats.updated) || 0,
            deleted: (stats && stats.deleted) || 0,
        }
    }

    /**
     * Stamp `source = origin` on every record when this pipeline carries
     * an origin label and the target mixes in the `sourced` aspect
     * (ADR 0012). No-op for legacy single-origin pipelines.
     */
    _stampOrigin(records) {
        if (!this.hasSourceAspect || !this.origin || !records || records.length === 0) return
        for (const rec of records) {
            rec.source = this.origin
        }
    }

    // ─── Tracker management ─────────────────────────────────────────────────────

    async _ensureTracker() {
        const existing = await SELECT.one.from(PIPELINES).where({ name: this.name })
        const baseJson = JSON.stringify(serializeBaseConfig(this.baseConfig))

        // Load persisted overrides before computing the effective config /
        // schedule. Survives process restart because addPipeline always
        // re-registers from code; we re-apply the stored JSON delta here.
        const loadedOverrides = existing ? parseOverridesJson(existing.overrides) : {}
        this.applyLoadedOverrides(loadedOverrides)

        const eff = this.config
        const desc = eff.description != null && eff.description !== '' ? eff.description : null
        // node:sqlite rejects JS booleans as bind params; store 0/1.
        const enabled = eff.enabled !== false ? 1 : 0

        if (!existing) {
            await INSERT.into(PIPELINES).entries({
                name: this.name,
                description: desc,
                source: JSON.stringify(this.baseConfig.source, this._safeReplacer),
                target: JSON.stringify(this.baseConfig.target, this._safeReplacer),
                mode: eff.mode || this.baseConfig.mode,
                origin: this.origin || null,
                schedule: formatScheduleLabel(eff.schedule),
                enabled,
                baseConfig: baseJson,
                overrides: Object.keys(loadedOverrides).length
                    ? JSON.stringify(loadedOverrides)
                    : null,
                status: 'idle',
                errorCount: 0,
                statistics_created: 0,
                statistics_updated: 0,
                statistics_deleted: 0,
            })
        } else {
            // Re-registrations: refresh baseConfig + display fields from the
            // new coded baseline / effective merge, but preserve `overrides`.
            const patch = {
                baseConfig: baseJson,
                source: JSON.stringify(this.baseConfig.source, this._safeReplacer),
                target: JSON.stringify(this.baseConfig.target, this._safeReplacer),
                mode: eff.mode || this.baseConfig.mode,
                schedule: formatScheduleLabel(eff.schedule),
                enabled,
                description: desc,
            }
            if (this.origin && existing.origin !== this.origin) {
                patch.origin = this.origin
            }
            await UPDATE(PIPELINES).set(patch).where({ name: this.name })
        }
    }

    /**
     * Persist current overrides (+ enabled / schedule label / mode) to the
     * tracker row after a setOverrides / setEnabled / setSchedule call.
     */
    async _persistOverrideState() {
        const overridesJson = Object.keys(this.overrides).length
            ? JSON.stringify(this.overrides)
            : null
        await UPDATE(PIPELINES).set({
            overrides: overridesJson,
            enabled: this.config.enabled !== false ? 1 : 0,
            schedule: formatScheduleLabel(this.config.schedule),
            mode: this.config.mode,
            description: this.config.description != null && this.config.description !== ''
                ? this.config.description
                : null,
        }).where({ name: this.name })
    }

    async _getTracker() {
        return SELECT.one.from(PIPELINES).where({ name: this.name })
    }

    /**
     * Reset the tracker row and clear the target. ADR 0012: when the
     * target mixes in the `sourced` aspect and this pipeline carries an
     * origin label, only rows tagged with that origin are deleted —
     * sibling origins in the same table are left intact. Legacy
     * pipelines (no aspect, no origin) keep today's truncate semantics.
     */
    async clear() {
        if (this.hasSourceAspect && this.origin) {
            await this.targetAdapter.deleteSlice(this.config.target, { source: this.origin })
            LOG._info && LOG.info(
                `Pipeline '${this.name}': flush scoped to source='${this.origin}'`
            )
        } else {
            await this.targetAdapter.truncate(this.config.target)
        }
        await UPDATE(PIPELINES).set({
            lastSync: null,
            lastKey: null,
            status: 'idle',
            errorCount: 0,
            statistics_created: 0,
            statistics_updated: 0,
            statistics_deleted: 0,
        }).where({ name: this.name })
    }

    async getStatus() {
        return this._getTracker()
    }
}

module.exports = Pipeline
