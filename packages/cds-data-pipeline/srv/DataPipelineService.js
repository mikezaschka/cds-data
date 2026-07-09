const cds = require('./runtime-cds')
const Pipeline = require('./lib/Pipeline')
const { extractViewMappingFromEntityDef } = require('./lib/extractViewMappingFromEntity')
const { inspectPipelineData, formatScheduleLabel, resolveInspectCapabilities } = require('./lib/inspectData')
const { flowMetadataForPipeline, buildLandscapeGraph } = require('./lib/flowMetadata')
const {
    validateOverridesPatch,
    clearOverrideKeys,
    buildConfigView,
    deepMerge,
} = require('./lib/overrides')
const { getHousekeepingConfig } = require('../lib/config-normalizer')
const { resolvePolicy, purgeRunsForPipeline } = require('./lib/housekeeping')

/** Reserved internal name for the global run-retention schedule registry entry. */
const HOUSEKEEPING_SCHEDULE_NAME = '__housekeeping'
const LOG = cds.log('cds-data-pipeline')
const PIPELINES = 'plugin_data_pipeline_Pipelines'

const PIPELINE_EVENTS = [
    'PIPELINE.START',
    'PIPELINE.READ',
    'PIPELINE.MAP',
    'PIPELINE.WRITE',
    'PIPELINE.DONE',
]

const VALID_SOURCE_KINDS = new Set(['cqn', 'odata', 'odata-v2', 'hcql', 'rest'])

// Row-delta `delta.mode` values are only meaningful for entity-shape reads.
// Query-shape pipelines must use `mode: 'full'` or `mode: 'partial-refresh'`.
const ROW_DELTA_MODES = new Set(['timestamp', 'key', 'datetime-fields'])

const DOC_REF = `See https://mikezaschka.github.io/cds-data/pipeline/guide/concepts/inference.html ` +
    `for the full inference + registration-validation rules.`

const DOC_REF_FAN_IN = `See https://mikezaschka.github.io/cds-data/pipeline/guide/recipes/multi-source.html ` +
    `for the multi-source fan-in rules.`

/** Matches `plugin.data_pipeline.Pipelines.description` in db/index.cds */
const PIPELINE_DESCRIPTION_MAX = 1024

/**
 * CDS service that orchestrates configured pipelines.
 *
 * Extends `cds.Service` so the pipeline runs through CAP's native event
 * dispatch. Five namespaced events bracket each run (prefix avoids
 * collision with CAP's CRUD aliases `READ` / `WRITE`):
 *
 *   PIPELINE.START — once per run, before READ
 *   PIPELINE.READ  — once per run, stream setup
 *   PIPELINE.MAP   — per batch
 *   PIPELINE.WRITE — per batch, after MAP
 *   PIPELINE.DONE  — once per run, success or failure
 *
 * Defaults per pipeline are stored in internal maps and invoked from a
 * single service-level `on()` router. User hooks registered via the standard
 * CAP `srv.before(event, path, handler)` / `srv.after(event, path, handler)`
 * API compose with defaults through CAP's native before -> on -> after chain.
 */
class DataPipelineService extends cds.Service {

    /**
     * `cds.connect.to()` constructs the service with the full app model. The
     * base `namespace` getter would then pick `model.namespace` (e.g. the
     * consumer package) instead of falling back to `this.name`. `dispatch`
     * would rewrite `req.path` in `_ensure_target` / `_ensure_fqn`, and user
     * hooks registered as `srv.before('PIPELINE.*', pipelineName, …)` — which
     * CAP canonicalizes to `${srv.name}.${pipelineName}` — would no longer
     * match. This orchestrator is not a modeled OData surface; keep the
     * namespace equal to the service name so `Pipeline._makeReq` paths stay
     * stable.
     */
    get namespace() {
        return this.name
    }

    async init() {
        this.pipelines = new Map()

        // Per-pipeline default handlers keyed by pipeline name.
        this._defaults = Object.fromEntries(
            PIPELINE_EVENTS.map(e => [e, new Map()])
        )

        /** @type {Map<string, { before: Set<string>, after: Set<string>, on: Set<string> }>} */
        this._pipelineHooks = new Map()

        // A single catch-all router for each pipeline event. Looks up the
        // default handler registered for `req.data.pipeline` and invokes
        // it; if no default is registered, calls `next()` so user-provided
        // `on` handlers can still supply the behavior.
        for (const event of PIPELINE_EVENTS) {
            this.on(event, (req, next) => this._route(event, req, next))
        }

        // Shared PIPELINE.TICK handler for the queued engine. Registered
        // unconditionally so ad-hoc `execute({ async: true, engine: 'queued' })`
        // works whether or not any pipeline carries a queued schedule. The
        // scheduled-schedule path (`_scheduleQueued`) reuses this handler
        // via `cds.queued(this).schedule('PIPELINE.TICK', { name })`.
        this.on('PIPELINE.TICK', async (req) => {
            const { name, mode = 'delta', trigger = 'scheduled', runId, tenant } = req.data || {}
            if (!name) return
            const pipeline = this.pipelines.get(name)
            if (!pipeline) {
                LOG.warn(`PIPELINE.TICK received for unknown pipeline '${name}'`)
                return
            }
            if (tenant) {
                const { runInTenantContext } = require('./lib/tenant-context')
                const { resolveTenantExecuteOpts } = require('./lib/TenantRunCoordinator')
                const tenantOpts = resolveTenantExecuteOpts(String(tenant), name, { mode, trigger, runId })
                await runInTenantContext(tenant, () => pipeline._run(tenantOpts.mode, tenantOpts.trigger, runId))
                return
            }
            await this._runScheduledPipeline(name, mode, trigger, runId, pipeline)
        })

        this.on('PIPELINE.HOUSEKEEPING', async () => {
            try {
                await this._runHousekeeping()
            } catch (err) {
                LOG.error('Pipeline run housekeeping failed:', err)
            }
        })

        /** @type {Map<string, { engine: 'spawn'|'queued', em?: import('node:events').EventEmitter, taskName?: string }>} */
        this._scheduleRegistry = new Map()

        await super.init()
        cds.once('served', () => {
            setImmediate(() => {
                this._startHousekeeping().catch((err) => {
                    LOG.warn(`Failed to start pipeline run housekeeping: ${err.message}`)
                })
            })
        })
        LOG._info && LOG.info('cds-data-pipeline ready')
    }

    /**
     * Register a pipeline. Pipeline behavior is inferred from the config
     * shape (`source.query` vs. `source.entity`) and dispatched through
     * protocol-specific source adapters and the configured target adapter.
     * See ADR 0007 and `concepts/inference.md` in the `cds-data-pipeline`
     * docs for the inference rules and the registration-time validation
     * matrix.
     */
    async addPipeline(config) {
        this._inferViewMappingIfMissing(config)
        this._validateConfig(config)
        const { name } = config
        if (this.pipelines.has(name)) {
            throw new Error(`Pipeline configuration '${name}' already exists`)
        }

        const internalConfig = this._normalizeConfig(config)

        try {
            const pipeline = new Pipeline(name, internalConfig, this)
            // init → _ensureTracker loads persisted overrides and applies them
            // onto pipeline.config before we start the schedule.
            await pipeline.init()
            this.pipelines.set(name, pipeline)

            const effective = pipeline.config
            if (effective.enabled !== false && effective.schedule) {
                this._startInternalSchedule(name, effective.schedule)
                await this._syncScheduleTracker(name, effective.schedule)
                LOG._info && LOG.info(
                    `Pipeline '${name}' has an internal schedule (engine=${effective.schedule.engine}). ` +
                    `Omit 'schedule' and call POST /pipeline/execute from an external scheduler ` +
                    `(SAP BTP Job Scheduling, Kubernetes CronJob, ...) if centralized scheduling is preferred.`
                )
            } else if (effective.enabled === false) {
                await this._syncScheduleTracker(name, effective.schedule || null)
                LOG._info && LOG.info(
                    `Pipeline '${name}' is disabled (overrides.enabled=false); schedule not started. ` +
                    `Manual start/execute still allowed.`
                )
            }

            LOG._info && LOG.info(this._composeRegistrationLog(name, effective, pipeline))

            // Initial load on startup (req 4.8.4). Runs one sync right after
            // registration, independent of any schedule. Skipped when the
            // pipeline is disabled so a paused pipeline stays fully quiet.
            if (effective.enabled !== false && effective.preload) {
                await this._runPreload(name, effective)
            }
        } catch (err) {
            LOG._error && LOG.error(`Failed to add pipeline ${name}:`, err)
            throw err
        }

        return this
    }

    /**
     * Run the initial-load-on-startup sync for a pipeline whose config sets
     * `preload` (req 4.8.4). `preload` has been normalized to
     * `{ wait: boolean, mode?: string }` by `_normalizePreload`.
     *
     *   - `wait: false` (default) — fire the run in the background via
     *     `execute({ async: true })` so app boot is not blocked. Rejections
     *     are already logged inside `execute`; we swallow the settled promise
     *     to avoid an unhandled rejection.
     *   - `wait: true` — await the run; a failure propagates out of
     *     `addPipeline` (and thus fails boot) so `wait` doubles as a
     *     fail-fast initial-load guarantee.
     *
     * The preload mode defaults to the pipeline's effective `mode`
     * (`delta` for entity-shape, `full` for query-shape). Override with
     * `preload.mode` to force a full initial load on an otherwise-delta
     * pipeline.
     */
    async _runPreload(name, effective) {
        const { wait, mode: preloadMode } = effective.preload
        const mode = preloadMode || effective.mode
        LOG._info && LOG.info(
            `Pipeline '${name}' preload enabled (mode=${mode}, wait=${wait}); ` +
            `running initial load at startup.`
        )
        try {
            const { done } = await this.execute(name, {
                mode,
                trigger: 'preload',
                async: !wait,
            })
            if (done) {
                if (wait) {
                    await done
                } else {
                    // Already logged in execute()'s spawn path; prevent an
                    // unhandled promise rejection from a background failure.
                    Promise.resolve(done).catch(() => {})
                }
            }
        } catch (err) {
            LOG._error && LOG.error(`Preload run for pipeline '${name}' failed:`, err)
            if (wait) throw err
        }
    }

    /**
     * Shape-based startup log line per ADR 0007 §"Observability compensation".
     * Strictly more informative than the old `kind=…` string: it names the
     * read shape, source/target refs, mode + delta mode, and the adapter
     * class resolved for the READ phase.
     *
     * Example:
     *   [cds-data-pipeline] registered 'OrdersCopy' — entity-shape from
     *     ProviderService.Orders → db.ArchivedOrders, mode=delta(timestamp
     *     modifiedAt), adapter=RemoteCqnAdapter
     */
    _composeRegistrationLog(name, config, pipeline) {
        const shape = config.source && config.source.query ? 'query-shape' : 'entity-shape'
        const sourceRef = (config.source && config.source.service ? config.source.service + '.' : '') +
            (config.source && config.source.entity ? config.source.entity : '<query>')
        const targetService = (config.target && config.target.service) || 'db'
        const targetRef = targetService + '.' + (config.target && config.target.entity ? config.target.entity : '<unknown>')
        const deltaMode = config.delta && config.delta.mode
        const deltaField = config.delta && config.delta.field
        const modePhrase = config.mode === 'full'
            ? 'full'
            : config.mode + (deltaMode ? '(' + deltaMode + (deltaField ? ' ' + deltaField : '') + ')' : '')
        const adapterName = (pipeline && pipeline.adapter && pipeline.adapter.constructor && pipeline.adapter.constructor.name) || '<unresolved>'
        const origin = config.source && config.source.origin
        const originSuffix = origin ? `, origin=${origin}` : ''
        return `registered '${name}' — ${shape} from ${sourceRef} → ${targetRef}, mode=${modePhrase}, adapter=${adapterName}${originSuffix}`
    }

    /**
     * Execute a pipeline. Uniform envelope return in all modes.
     *
     *   @param {string} name
     *   @param {object} [opts]
     *   @param {'full'|'delta'|'partial-refresh'} [opts.mode='delta']
     *   @param {'manual'|'scheduled'|'external'|'event'} [opts.trigger='manual']
     *   @param {boolean} [opts.async=false]   true = fire-and-forget, false = block
     *   @param {'spawn'|'queued'} [opts.engine='spawn']  only honored when async=true
     *   @param {object} [opts.event]  ADR 0013: structured event micro-run
     *     (`read`, `action`, `keys` / `payload`); requires `trigger: 'event'`
     *     semantics (trigger is set automatically when `event` is set).
     *   @returns {Promise<{ runId: string, name: string, done?: Promise }>}
     *
     * Behavior:
     *   - async=false: awaits the run; resolves with `done` already settled
     *     to `{ status, statistics }`. Failures throw.
     *   - async=true, engine='spawn': resolves immediately; `done` is a
     *     pending Promise that resolves to `{ status, statistics }` on
     *     success or rejects on failure. Unhandled rejections are also
     *     logged via cds.log.
     *   - async=true, engine='queued': resolves after the enqueue; `done`
     *     is omitted (the run may execute on another instance). Use
     *     `after('PIPELINE.DONE', name, ...)` for notifications.
     */
    async execute(name, opts = {}) {
        const {
            mode = 'delta',
            trigger: triggerOpt = 'manual',
            async: isAsync = false,
            engine = 'spawn',
            event: eventBlock,
        } = opts

        const pipeline = this.pipelines.get(name)
        if (!pipeline) {
            throw new Error(`Unknown pipeline: ${name}`)
        }

        if (eventBlock != null) {
            this._validateEventExecute(pipeline.config, eventBlock, name)
        }

        if (eventBlock != null && isAsync && engine === 'queued') {
            throw new Error(
                `execute: event micro-runs (opts.event) do not support async with engine='queued' in v1 (ADR 0013). ` +
                `Use async: false, or async: true with engine: 'spawn'.`
            )
        }

        const trigger = eventBlock != null ? 'event' : triggerOpt
        const runId = cds.utils.uuid()
        const eventPayload = eventBlock != null ? { event: eventBlock } : null

        const run = () => pipeline._run(mode, trigger, runId, eventPayload)

        if (!isAsync) {
            const { runWithEntityCacheTenant } = require('./lib/entity-cache-tenant')
            const result = opts.tenant != null
                ? await runWithEntityCacheTenant(opts.tenant, run)
                : await run()
            return { runId, name, done: Promise.resolve(result) }
        }

        if (engine === 'queued') {
            if (typeof cds.queued !== 'function') {
                throw new Error(
                    `execute: async with engine='queued' requires a CAP runtime that exposes ` +
                    `cds.queued(srv). Update @sap/cds, or use async:true with engine:'spawn' ` +
                    `(default), or omit async for a blocking run.`
                )
            }
            const queued = cds.queued(this)
            if (!queued || typeof queued.emit !== 'function') {
                throw new Error(
                    `execute: cds.queued(srv).emit(...) is not available on this CAP runtime. ` +
                    `Fall back to engine:'spawn' or a blocking call.`
                )
            }
            await queued.emit('PIPELINE.TICK', { name, mode, trigger, runId })
            return { runId, name }
        }

        // engine === 'spawn' (default async path)
        let resolve, reject
        const done = new Promise((res, rej) => { resolve = res; reject = rej })
        cds.spawn(async () => {
            try {
                resolve(await pipeline._run(mode, trigger, runId, eventPayload))
            } catch (err) {
                LOG._error && LOG.error(`Async pipeline '${name}' failed:`, err)
                reject(err)
            }
        })
        return { runId, name, done }
    }

    /**
     * Execute a pipeline inside an explicit tenant context (ADR 0010 / 4.15.1).
     */
    async executeForTenant(tenant, name, opts = {}) {
        const { resolveTenantExecuteOpts } = require('./lib/TenantRunCoordinator')
        const tenantOpts = resolveTenantExecuteOpts(String(tenant), name, opts)
        return this.execute(name, { ...tenantOpts, tenant: String(tenant) })
    }

    async _runScheduledPipeline(name, mode, trigger, runId, pipeline) {
        if (pipeline.config && pipeline.config.enabled === false) {
            LOG._debug && LOG.debug(`Scheduled tick skipped for disabled pipeline '${name}'`)
            return
        }
        const { shouldFanOutScheduledRuns, runForAllTenants } = require('./lib/TenantRunCoordinator')
        if (shouldFanOutScheduledRuns()) {
            await runForAllTenants(this, name, { mode, trigger, runId })
            return
        }
        await pipeline._run(mode, trigger, runId)
    }

    /**
     * Start the global run-retention sweep when `cds.requires.*.housekeeping`
     * enables retentionDays and/or maxRuns.
     */
    async _startHousekeeping() {
        this._housekeepingGlobal = getHousekeepingConfig(cds.env.requires ?? {})
        if (!this._housekeepingGlobal.enabled) return

        const normalizedSchedule = this._normalizeSchedule(
            this._housekeepingGlobal.schedule,
            HOUSEKEEPING_SCHEDULE_NAME,
        )
        if (!normalizedSchedule) return

        this._stopInternalSchedule(HOUSEKEEPING_SCHEDULE_NAME)

        if (normalizedSchedule.engine === 'queued') {
            const taskName = this._scheduleHousekeepingQueued(normalizedSchedule.every)
            this._scheduleRegistry.set(HOUSEKEEPING_SCHEDULE_NAME, {
                engine: 'queued',
                taskName,
            })
        } else {
            const em = this._scheduleHousekeepingSpawn(normalizedSchedule.every)
            this._scheduleRegistry.set(HOUSEKEEPING_SCHEDULE_NAME, {
                engine: 'spawn',
                em,
            })
        }

        LOG.info(
            `Pipeline run housekeeping enabled (engine=${normalizedSchedule.engine}, ` +
            `retentionDays=${this._housekeepingGlobal.retentionDays ?? 'unset'}, ` +
            `maxRuns=${this._housekeepingGlobal.maxRuns ?? 'unset'})`,
        )
    }

    _scheduleHousekeepingSpawn(every) {
        const interval = typeof every === 'number' ? every : parseInt(every, 10)
        if (!interval || interval <= 0) {
            LOG.warn(`Invalid housekeeping schedule: ${every}`)
            return undefined
        }
        return cds.spawn({ every: interval }, async () => {
            await this._runHousekeeping()
        })
    }

    _scheduleHousekeepingQueued(every) {
        if (typeof cds.queued !== 'function') {
            throw new Error(
                `housekeeping schedule.engine='queued' requires a CAP runtime that exposes ` +
                `cds.queued(srv).schedule(...).every(...).`,
            )
        }
        const queued = cds.queued(this)
        if (!queued || typeof queued.schedule !== 'function') {
            throw new Error(
                `housekeeping: cds.queued(srv).schedule(...) is not available on this CAP runtime.`,
            )
        }
        const handle = queued.schedule('PIPELINE.HOUSEKEEPING', {})
        if (!handle || typeof handle.every !== 'function') {
            throw new Error(
                `housekeeping: cds.queued(srv).schedule(...).every(...) is not available on this CAP runtime.`,
            )
        }
        const scheduled = handle.every(every)
        const asTarget = (scheduled && typeof scheduled.as === 'function') ? scheduled
            : (typeof handle.as === 'function' ? handle : undefined)
        if (asTarget) {
            const taskName = this._queuedTaskName(HOUSEKEEPING_SCHEDULE_NAME)
            asTarget.as(taskName)
            return taskName
        }
        return undefined
    }

    /**
     * Sweep all registered pipelines and prune finished PipelineRuns rows.
     */
    async _runHousekeeping() {
        const globalPolicy = this._housekeepingGlobal || getHousekeepingConfig(cds.env.requires ?? {})
        if (!globalPolicy.enabled) return { deleted: 0 }

        const { shouldFanOutScheduledRuns, listTenants, runInTenantContext } =
            require('./lib/TenantRunCoordinator')

        const sweep = async () => {
            let deleted = 0
            for (const [name, pipeline] of this.pipelines) {
                const policy = resolvePolicy(pipeline.config?.retention, globalPolicy)
                if (!policy.enabled) continue
                const result = await purgeRunsForPipeline(name, policy)
                deleted += result.deleted
            }
            return deleted
        }

        if (shouldFanOutScheduledRuns()) {
            const tenants = await listTenants()
            let deleted = 0
            for (const tenant of tenants) {
                deleted += await runInTenantContext(tenant, sweep)
            }
            return { deleted }
        }

        return { deleted: await sweep() }
    }

    /**
     * ADR 0013 — thin alias: defaults `trigger: 'event'`, `event.action: 'upsert'`
     * when omitted, forwards `async` / `engine` to {@link #execute}.
     */
    async executeEvent(name, opts = {}) {
        if (!opts || typeof opts !== 'object') {
            throw new Error('executeEvent requires an options object')
        }
        const { event, ...rest } = opts
        if (!event || typeof event.read !== 'string') {
            throw new Error("executeEvent: options.event with string property 'read' is required (ADR 0013)")
        }
        const mergedEvent = { action: 'upsert', ...event }
        return this.execute(name, { ...rest, trigger: 'event', event: mergedEvent })
    }

    /**
     * Validates ADR 0013 `event` block before `execute` runs.
     * @param {object} config - normalized pipeline config
     * @param {object} event
     * @param {string} name - pipeline name (for error messages)
     */
    _validateEventExecute(config, event, name) {
        if (config.source && config.source.query) {
            throw new Error(
                `execute: event path is not supported for query-shape pipelines (source.query) in v1: '${name}' (ADR 0013)`
            )
        }
        if (event.read !== 'key' && event.read !== 'payload') {
            throw new Error(
                `execute: event.read must be 'key' or 'payload' for pipeline '${name}' (ADR 0013)`
            )
        }
        const action = event.action == null ? 'upsert' : event.action
        if (action !== 'upsert' && action !== 'delete') {
            throw new Error(
                `execute: event.action must be 'upsert' or 'delete' for pipeline '${name}' (got '${action}')`
            )
        }
        if (action === 'delete' && event.read === 'payload') {
            throw new Error(
                `execute: event action delete with read:payload is not supported in v1 for pipeline '${name}' (ADR 0013)`
            )
        }
        if (event.read === 'key') {
            if (!event.keys || typeof event.keys !== 'object' || Object.keys(event.keys).length === 0) {
                throw new Error(
                    `execute: event read:key requires a non-empty event.keys object for pipeline '${name}' (ADR 0013)`
                )
            }
        }
        if (action === 'upsert' && event.read === 'payload') {
            if (event.payload === undefined) {
                throw new Error(
                    `execute: event read:payload with action upsert requires event.payload for pipeline '${name}' (ADR 0013)`
                )
            }
        }
    }

    async getStatus(name) {
        const pipeline = this.pipelines.get(name)
        if (!pipeline) {
            throw new Error(`Unknown pipeline: ${name}`)
        }
        return pipeline.getStatus()
    }

    /**
     * Preview source or target data for the Pipeline Console data inspector.
     *
     * @param {string} name
     * @param {object} opts
     * @returns {Promise<string>} JSON payload
     */
    async inspectData(name, opts = {}) {
        const pipeline = this.pipelines.get(name)
        if (!pipeline) {
            throw new Error(`Unknown pipeline: ${name}`)
        }
        return inspectPipelineData(pipeline, opts)
    }

    /**
     * Inspect tab availability for the Pipeline Console.
     *
     * @param {string} name
     * @returns {Promise<string>} JSON payload
     */
    async inspectCapabilities(name) {
        const pipeline = this.pipelines.get(name)
        if (!pipeline) {
            throw new Error(`Unknown pipeline: ${name}`)
        }
        return JSON.stringify(resolveInspectCapabilities(pipeline))
    }

    /**
     * Flow metadata for the Pipeline Console: lifecycle events, customizations,
     * and a graph payload (source → events → target).
     *
     * @param {string} name
     * @returns {Promise<string>} JSON payload
     */
    async getFlowMetadata(name, opts = {}) {
        const pipeline = this.pipelines.get(name)
        if (!pipeline) {
            throw new Error(`Unknown pipeline: ${name}`)
        }
        const tracker = await pipeline.getStatus()
        const status = opts.status || (tracker && tracker.status) || 'idle'
        return JSON.stringify(flowMetadataForPipeline(pipeline, this._pipelineHooks, status, opts))
    }

    /**
     * Landscape metadata for the Pipeline Console master view: all pipelines
     * with a deduplicated source/pipeline/target graph.
     *
     * @param {object} [opts]
     * @returns {Promise<string>} JSON payload
     */
    async getLandscapeMetadata(opts = {}) {
        const items = []
        for (const pipeline of this.pipelines.values()) {
            const tracker = await pipeline.getStatus()
            const status = (tracker && tracker.status) || 'idle'
            items.push(flowMetadataForPipeline(pipeline, this._pipelineHooks, status, opts))
        }
        return JSON.stringify({
            pipelines: items,
            graph: buildLandscapeGraph(items, opts),
            pipelineCount: items.length,
        })
    }

    before(event, pathOrHandler, handler) {
        if (typeof pathOrHandler === 'string' && typeof handler === 'function') {
            this._trackPipelineHook(pathOrHandler, 'before', event)
        }
        return super.before(event, pathOrHandler, handler)
    }

    after(event, pathOrHandler, handler) {
        if (typeof pathOrHandler === 'string' && typeof handler === 'function') {
            this._trackPipelineHook(pathOrHandler, 'after', event)
        }
        return super.after(event, pathOrHandler, handler)
    }

    on(event, pathOrHandler, handler) {
        if (typeof pathOrHandler === 'string' && typeof handler === 'function') {
            this._trackPipelineHook(pathOrHandler, 'on', event)
        }
        return super.on(event, pathOrHandler, handler)
    }

    _trackPipelineHook(pipelineName, phase, event) {
        if (!PIPELINE_EVENTS.includes(event)) return
        let entry = this._pipelineHooks.get(pipelineName)
        if (!entry) {
            entry = { before: new Set(), after: new Set(), on: new Set() }
            this._pipelineHooks.set(pipelineName, entry)
        }
        entry[phase].add(event)
    }

    async _syncScheduleTracker(name, schedule) {
        const label = formatScheduleLabel(schedule)
        await UPDATE(PIPELINES).set({ schedule: label }).where({ name })
    }

    async clear(name) {
        const pipeline = this.pipelines.get(name)
        if (!pipeline) {
            throw new Error(`Unknown pipeline: ${name}`)
        }
        await pipeline.clear()
    }

    /**
     * Stops an internal schedule and records a schedule:null override so the
     * clear survives restart (coded schedule will not restart until the
     * override is cleared).
     *
     * Spawn schedules are always cancelable (`clearInterval`). Queued
     * schedules are cancelable on CAP runtimes that expose named-task
     * unschedule (CDS 10: `srv.schedule(...).as(name)` + `srv.unschedule(name)`).
     * On older runtimes (CDS 9) that lack that API, queued schedules cannot be
     * stopped at runtime and this throws with guidance.
     */
    async clearSchedule(name) {
        const pipeline = this.pipelines.get(name)
        if (!pipeline) {
            throw new Error(`Unknown pipeline: ${name}`)
        }
        this._assertScheduleLiveChange(name, 'clearSchedule')
        await this._stopInternalSchedule(name)
        const next = { ...pipeline.overrides, schedule: null }
        pipeline.applyLoadedOverrides(next)
        await pipeline._persistOverrideState()
        return `Internal schedule cleared for pipeline '${name}'.`
    }

    /**
     * Replaces the internal schedule via a persisted override. `every` may be
     * milliseconds, a time string, or (queued engine only) a 5-field cron
     * expression. Alias: pass `cron` instead of `every` for cron strings.
     * The engine defaults to the pipeline's current engine unless overridden.
     *
     * Queued reschedules require named-task unschedule support (CDS 10);
     * otherwise this throws, matching {@link clearSchedule}.
     */
    async setSchedule(name, { every, cron, engine } = {}) {
        const pipeline = this.pipelines.get(name)
        if (!pipeline) {
            throw new Error(`Unknown pipeline: ${name}`)
        }
        this._assertScheduleLiveChange(name, 'setSchedule')
        const scheduleInput = cron != null ? cron : every
        const rec = this._scheduleRegistry.get(name)
        const currentEngine = (rec && rec.engine)
            || (pipeline.config && pipeline.config.schedule && pipeline.config.schedule.engine)
            || (pipeline.baseConfig && pipeline.baseConfig.schedule && pipeline.baseConfig.schedule.engine)
            || 'spawn'
        const normalized = this._normalizeSchedule(
            { every: scheduleInput, engine: engine || currentEngine },
            name,
        )
        if (!normalized) {
            throw new Error(
                'setSchedule: `every` (or `cron`) must be a positive interval (milliseconds), ' +
                'time string, or cron expression.',
            )
        }
        const next = { ...pipeline.overrides, schedule: normalized }
        pipeline.applyLoadedOverrides(next)
        await this._hotApplySchedule(name, pipeline)
        await pipeline._persistOverrideState()
        return `Schedule set for pipeline '${name}': every=${normalized.every}, engine=${normalized.engine}.`
    }

    /**
     * Merge a validated overrides patch onto the pipeline, persist, and
     * hot-apply schedule/enabled changes.
     *
     * @param {string} name
     * @param {object} patch - plain object of overridable fields
     */
    async setOverrides(name, patch) {
        const pipeline = this.pipelines.get(name)
        if (!pipeline) {
            throw new Error(`Unknown pipeline: ${name}`)
        }
        const cleaned = validateOverridesPatch(patch)
        if ('schedule' in cleaned) {
            if (cleaned.schedule !== null) {
                const normalized = this._normalizeSchedule(cleaned.schedule, name)
                if (!normalized) {
                    throw new Error(
                        'setOverrides: schedule must be a positive interval (ms), time string, ' +
                        'cron expression, { every, engine? }, or null to clear.',
                    )
                }
                cleaned.schedule = normalized
            }
        }
        if ('schedule' in cleaned || 'enabled' in cleaned) {
            this._assertScheduleLiveChange(name, 'setOverrides')
        }
        // Deep-merge nested objects (source / delta / flags); replace scalars.
        const merged = { ...pipeline.overrides }
        for (const [key, value] of Object.entries(cleaned)) {
            if (key === 'source' || key === 'delta' || key === 'flags') {
                merged[key] = deepMerge(merged[key] || {}, value)
            } else {
                merged[key] = value
            }
        }
        const scheduleTouched = 'schedule' in cleaned || 'enabled' in cleaned
        pipeline.applyLoadedOverrides(merged)
        if (scheduleTouched) {
            await this._hotApplySchedule(name, pipeline)
        }
        await pipeline._persistOverrideState()
        return this.getConfigView(name)
    }

    /**
     * Remove override keys (or all overrides when `keys` omitted / empty).
     * @param {string} name
     * @param {string[]|string|null} [keys]
     */
    async clearOverrides(name, keys) {
        const pipeline = this.pipelines.get(name)
        if (!pipeline) {
            throw new Error(`Unknown pipeline: ${name}`)
        }

        const clearAll = keys == null || keys === '' || (Array.isArray(keys) && keys.length === 0)
        let keyList
        if (clearAll) {
            keyList = Object.keys(pipeline.overrides)
        } else if (typeof keys === 'string') {
            keyList = keys.split(',').map((k) => k.trim()).filter(Boolean)
        } else if (Array.isArray(keys)) {
            keyList = keys.map(String)
        } else {
            throw new Error('clearOverrides: keys must be a comma-separated string, array, or omitted')
        }

        const scheduleTouched = clearAll || keyList.some(
            (k) => k === 'schedule' || k === 'enabled' || k.startsWith('schedule.'),
        )
        if (scheduleTouched) {
            this._assertScheduleLiveChange(name, 'clearOverrides')
        }

        const next = clearAll ? {} : clearOverrideKeys(pipeline.overrides, keyList)
        pipeline.applyLoadedOverrides(next)

        if (scheduleTouched) {
            await this._hotApplySchedule(name, pipeline)
        }
        await pipeline._persistOverrideState()
        return this.getConfigView(name)
    }

    /**
     * Pause (`false`) or resume (`true`) scheduled ticks. Manual execute still works.
     */
    async setEnabled(name, enabled) {
        if (typeof enabled !== 'boolean') {
            throw new Error('setEnabled: enabled must be a boolean')
        }
        return this.setOverrides(name, { enabled })
    }

    /**
     * Config view for API / console: base, overrides, effective, field meta.
     */
    getConfigView(name) {
        const pipeline = this.pipelines.get(name)
        if (!pipeline) {
            throw new Error(`Unknown pipeline: ${name}`)
        }
        return buildConfigView({
            baseConfig: pipeline.baseConfig,
            overrides: pipeline.overrides,
            effectiveConfig: pipeline.config,
            scheduleLiveChangeSupported: this.isScheduleLiveChangeSupported(name),
        })
    }

    /**
     * True when the current schedule (if any) can be stopped/replaced without
     * a process restart. Spawn is always live; queued needs CDS 10 named tasks.
     */
    isScheduleLiveChangeSupported(name) {
        const pipeline = this.pipelines.get(name)
        if (!pipeline) return true
        const rec = this._scheduleRegistry.get(name)
        if (!rec) {
            // No live timer — starting a new spawn schedule is always fine;
            // starting queued still requires cds.queued, but that's a separate check.
            return true
        }
        if (rec.engine === 'spawn') return true
        return this._canUnscheduleQueued(rec)
    }

    _assertScheduleLiveChange(name, op) {
        const rec = this._scheduleRegistry.get(name)
        if (rec && rec.engine === 'queued' && !this._canUnscheduleQueued(rec)) {
            throw new Error(
                `${op}: pipeline '${name}' uses schedule.engine='queued' on a CAP runtime ` +
                `without named-task unschedule support. Upgrade to a runtime that exposes ` +
                `srv.schedule(...).as(name) + srv.unschedule(name) (CDS 10), use ` +
                `schedule.engine='spawn', or restart the app.`,
            )
        }
    }

    /**
     * Stop any live timer and (re)start from effective schedule when enabled.
     */
    async _hotApplySchedule(name, pipeline) {
        await this._stopInternalSchedule(name)
        const eff = pipeline.config
        if (eff.enabled !== false && eff.schedule) {
            this._startInternalSchedule(name, eff.schedule)
        }
        await this._syncScheduleTracker(name, (eff.enabled !== false && eff.schedule) ? eff.schedule : null)
    }

    /**
     * True when a queued schedule can be cancelled at runtime — i.e. it was
     * registered with a task name (`.as(name)`) and the runtime exposes an
     * `unschedule` function.
     */
    _canUnscheduleQueued(rec) {
        return !!(rec && rec.taskName) && this._queuedUnscheduleSupported()
    }

    /**
     * Register an internal default handler for a pipeline phase.
     * Called by `Pipeline.init()` — not part of the public API.
     */
    registerDefault(event, pipelineName, handler) {
        const bucket = this._defaults[event]
        if (!bucket) {
            throw new Error(`Unknown pipeline event '${event}'`)
        }
        bucket.set(pipelineName, handler)
    }

    _route(event, req, next) {
        const pipelineName = req.data && req.data.pipeline
        const handler = pipelineName && this._defaults[event].get(pipelineName)
        if (handler) return handler(req)
        return typeof next === 'function' ? next() : undefined
    }

    /**
     * Start internal timer(s) for a pipeline. `schedule` is `{ every, engine }` from `_normalizeConfig`.
     * Spawn handles are stored so `clearInterval` can stop them; queued schedules are registered
     * for diagnostics only (cannot be cancelled at runtime).
     */
    _startInternalSchedule(name, schedule) {
        this._stopInternalSchedule(name)
        const { every, engine } = schedule
        if (engine === 'queued') {
            const taskName = this._scheduleQueued(name, every)
            this._scheduleRegistry.set(name, { engine: 'queued', taskName })
            return
        }
        const em = this._scheduleSpawn(name, every)
        if (em) {
            this._scheduleRegistry.set(name, { engine: 'spawn', em })
        }
    }

    /**
     * Stop an internal schedule. For spawn, clears the `setInterval`. For
     * queued, calls `unschedule(taskName)` when the runtime supports it
     * (CDS 10). No-op if nothing registered. Returns a promise so async
     * callers (clearSchedule / setSchedule) can await the queued teardown.
     */
    _stopInternalSchedule(name) {
        const rec = this._scheduleRegistry.get(name)
        this._scheduleRegistry.delete(name)
        if (!rec) return undefined
        if (rec.engine === 'spawn') {
            const t = rec.em && rec.em.timer
            if (t) clearInterval(t)
            return undefined
        }
        if (rec.engine === 'queued' && rec.taskName) {
            return this._unscheduleQueued(rec.taskName)
        }
        return undefined
    }

    /**
     * Dispatch a pipeline schedule to the configured engine. `schedule` has
     * already been normalized to `{ every, engine }` by `_normalizeConfig`.
     *
     *   - `engine: 'spawn'` (default) — in-process `cds.spawn({ every })`.
     *     Best-effort, fires on every app instance, no persistence across
     *     restarts, no retry. Matches pre-0.2 behaviour.
     *   - `engine: 'queued'` — `cds.queued(this).schedule(...).every(...)`
     *     backed by the CAP persistent task queue. Single-winner across
     *     app instances, survives restarts, exponential retry + dead-letter
     *     via `cds.outbox.Messages`. The underlying CAP API is marked
     *     Alpha; opt in per-pipeline.
     *
     * @returns {import('node:events').EventEmitter|undefined} EventEmitter for spawn; undefined for invalid or queued
     */
    _scheduleSpawn(name, every) {
        const interval = typeof every === 'number' ? every : parseInt(every, 10)
        if (!interval || interval <= 0) {
            LOG.warn(`Invalid schedule for '${name}': ${every}`)
            return undefined
        }
        return cds.spawn({ every: interval }, async () => {
            try {
                const pip = this.pipelines.get(name)
                if (!pip) return
                await this._runScheduledPipeline(name, 'delta', 'scheduled', undefined, pip)
            } catch (err) {
                LOG._error && LOG.error(`Scheduled pipeline failed for ${name}:`, err)
            }
        })
    }

    _scheduleQueued(name, every) {
        if (typeof cds.queued !== 'function') {
            throw new Error(
                `addPipeline: schedule.engine='queued' requires a CAP runtime that exposes ` +
                `cds.queued(srv).schedule(...).every(...). Update @sap/cds, or use ` +
                `schedule: <ms> / schedule: { every, engine: 'spawn' } / omit schedule ` +
                `and trigger externally via POST /pipeline/execute.`
            )
        }

        // The shared PIPELINE.TICK handler is registered in `init()` so
        // both scheduled and ad-hoc queued execution share one dispatch
        // path. Here we only enqueue the recurring schedule message.
        const queued = cds.queued(this)
        if (!queued || typeof queued.schedule !== 'function') {
            throw new Error(
                `addPipeline: cds.queued(srv).schedule(...) is not available on this CAP runtime. ` +
                `Use schedule: <ms> or omit schedule and trigger externally.`
            )
        }

        const handle = queued.schedule('PIPELINE.TICK', { name })
        if (!handle || typeof handle.every !== 'function') {
            throw new Error(
                `addPipeline: cds.queued(srv).schedule(...).every(...) is not available on this ` +
                `CAP runtime. The task scheduling API is documented as Alpha; check the CAP release ` +
                `notes or fall back to schedule.engine='spawn'.`
            )
        }

        // CDS 10 adds `.as(name)` for named singleton tasks that can later be
        // cancelled via `unschedule(name)`. When available, name the task so
        // clearSchedule / setSchedule can stop or replace it at runtime. On
        // CDS 9 (no `.as`), fall back to an anonymous, non-cancelable schedule.
        const scheduled = handle.every(every)
        const asTarget = (scheduled && typeof scheduled.as === 'function') ? scheduled
            : (typeof handle.as === 'function' ? handle : undefined)
        if (asTarget) {
            const taskName = this._queuedTaskName(name)
            asTarget.as(taskName)
            return taskName
        }
        return undefined
    }

    /** Deterministic, collision-resistant task name for a pipeline's queued schedule. */
    _queuedTaskName(name) {
        return `cds-data-pipeline:${name}`
    }

    /**
     * True when the runtime exposes an `unschedule` function (on the queued
     * proxy or the service itself). Introduced with the CDS 10 Event Queues
     * scheduling API.
     */
    _queuedUnscheduleSupported() {
        let queued
        if (typeof cds.queued === 'function') {
            try { queued = cds.queued(this) } catch { /* ignore */ }
        }
        return (!!queued && typeof queued.unschedule === 'function')
            || typeof this.unschedule === 'function'
    }

    /**
     * Cancel a named queued task. Tolerates both `cds.queued(srv).unschedule`
     * and `srv.unschedule`. Returns the underlying promise (or undefined).
     */
    _unscheduleQueued(taskName) {
        try {
            let queued
            if (typeof cds.queued === 'function') {
                try { queued = cds.queued(this) } catch { /* ignore */ }
            }
            if (queued && typeof queued.unschedule === 'function') {
                return queued.unschedule(taskName)
            }
            if (typeof this.unschedule === 'function') {
                return this.unschedule(taskName)
            }
        } catch (err) {
            LOG.warn(`Failed to unschedule queued task '${taskName}': ${err.message}`)
        }
        return undefined
    }

    /**
     * Registration-time invariants per ADR 0007 §"Registration-time
     * validation matrix". Pipeline behavior is inferred from config shape.
     * Rows 1-5 are shape invariants; rows 6-8 are target-adapter capability
     * checks evaluated against the resolved `TargetAdapter.capabilities()`.
     */
    /**
     * When `viewMapping` is omitted, derive projected columns and renames from the
     * target entity's CDS projection (consumption view), if present in `cds.model`.
     * Explicit `viewMapping` (including `{}`) is left unchanged.
     */
    _inferViewMappingIfMissing(config) {
        if (config.viewMapping !== undefined && config.viewMapping !== null) return
        const targetEntity = config.target && config.target.entity
        if (!targetEntity || !cds.model || !cds.model.definitions) return
        const def = cds.model.definitions[targetEntity]
        if (!def) return
        const inferred = extractViewMappingFromEntityDef(def)
        if (inferred != null) {
            config.viewMapping = inferred
        }
    }

    _validateConfig(config) {
        if (!config || typeof config !== 'object') {
            throw new Error(`addPipeline requires a configuration object`)
        }
        const { name } = config
        if (!name) {
            throw new Error(`addPipeline requires 'name'`)
        }

        if (config.description !== undefined && config.description !== null) {
            if (typeof config.description !== 'string') {
                throw new Error(`addPipeline: description must be a string for pipeline '${name}'`)
            }
            const trimmed = config.description.trim()
            if (trimmed.length > PIPELINE_DESCRIPTION_MAX) {
                throw new Error(
                    `addPipeline: description exceeds ${PIPELINE_DESCRIPTION_MAX} characters for pipeline '${name}'`
                )
            }
        }

        const source = config.source
        const hasQuery = !!(source && source.query)
        const hasEntity = !!(source && source.entity)
        // REST pipelines address their source via `config.rest.path` rather
        // than a CAP entity reference. Treat `rest.path` as an entity-shape
        // signal equivalent to `source.entity` for Row 1 / Row 2 purposes.
        const hasRestPath = !!(config.rest && config.rest.path)
        const hasEntityShape = hasEntity || hasRestPath

        // Row 1: ambiguous source shape
        if (hasQuery && hasEntityShape) {
            throw new Error(
                `addPipeline: ambiguous source shape for pipeline '${name}' — set one of ` +
                `source.query or source.entity (or rest.path for REST sources), not both. ` +
                DOC_REF
            )
        }

        // Row 2: missing source shape
        if (!hasQuery && !hasEntityShape) {
            throw new Error(
                `addPipeline: missing source shape for pipeline '${name}' — set either ` +
                `source.entity (or rest.path for REST sources) for entity-shape reads ` +
                `or source.query for query-shape reads. ` + DOC_REF
            )
        }

        // Row 3: query-shape + mode: 'delta' → row-delta requires entity-shape
        if (hasQuery && config.mode === 'delta') {
            throw new Error(
                `addPipeline: row-delta requires entity-shape source (source.entity) for pipeline '${name}'; ` +
                `query-shape reads use mode: 'full' or mode: 'partial-refresh'. ${DOC_REF}`
            )
        }

        // Row 4: query-shape + delta.mode ∈ { timestamp, key, datetime-fields }
        if (hasQuery && config.delta && ROW_DELTA_MODES.has(config.delta.mode)) {
            throw new Error(
                `addPipeline: delta.mode '${config.delta.mode}' requires entity-shape source for pipeline '${name}'; ` +
                `query-shape reads do not support row-delta. ${DOC_REF}`
            )
        }

        // Row 5: mode: 'partial-refresh' without refresh.slice
        const refresh = config.refresh
        const partialViaMode = config.mode === 'partial-refresh'
        const partialViaRefresh = refresh && typeof refresh === 'object' && refresh.mode === 'partial'
        if ((partialViaMode || partialViaRefresh) &&
            (!refresh || typeof refresh !== 'object' || typeof refresh.slice !== 'function')) {
            throw new Error(
                `addPipeline: partial-refresh requires refresh.slice: (tracker) => <CQN predicate> ` +
                `for pipeline '${name}'. ${DOC_REF}`
            )
        }

        this._validateSource(config)
        this._validateOrigin(config)
        this._validateRetention(config)
        this._validatePreload(config)
    }

    /**
     * Validate the `preload` option (initial load on startup, req 4.8.4).
     *
     * Accepted shapes:
     *   - unset / null / false     -> no preload
     *   - true                     -> preload with the pipeline's effective mode
     *   - { mode?, wait? }         -> `mode` must be a valid run mode for the
     *                                 source shape; `wait` must be a boolean.
     */
    _validatePreload(config) {
        const { preload, name } = config
        if (preload === undefined || preload === null || preload === false || preload === true) {
            return
        }
        if (typeof preload !== 'object' || Array.isArray(preload)) {
            throw new Error(
                `addPipeline: preload must be a boolean or { mode?, wait? } for pipeline '${name}'`
            )
        }
        if (preload.wait !== undefined && typeof preload.wait !== 'boolean') {
            throw new Error(`addPipeline: preload.wait must be a boolean for pipeline '${name}'`)
        }
        if (preload.mode !== undefined) {
            const isQueryShape = !!(config.source && config.source.query)
            if (!['full', 'delta', 'partial-refresh'].includes(preload.mode)) {
                throw new Error(
                    `addPipeline: preload.mode must be 'full', 'delta', or 'partial-refresh' ` +
                    `for pipeline '${name}'`
                )
            }
            if (isQueryShape && preload.mode === 'delta') {
                throw new Error(
                    `addPipeline: preload.mode 'delta' requires an entity-shape source for pipeline '${name}'; ` +
                    `query-shape reads use 'full' or 'partial-refresh'. ${DOC_REF}`
                )
            }
            if (preload.mode === 'partial-refresh') {
                const refresh = config.refresh
                if (!refresh || typeof refresh !== 'object' || typeof refresh.slice !== 'function') {
                    throw new Error(
                        `addPipeline: preload.mode 'partial-refresh' requires ` +
                        `refresh.slice: (tracker) => <CQN predicate> for pipeline '${name}'. ${DOC_REF}`
                    )
                }
            }
        }
    }

    _validateRetention(config) {
        const { retention, name } = config
        if (retention === undefined || retention === null) return
        if (typeof retention !== 'object' || Array.isArray(retention)) {
            throw new Error(`addPipeline: retention must be a plain object for pipeline '${name}'`)
        }
        for (const key of ['retentionDays', 'maxRuns']) {
            if (retention[key] === undefined || retention[key] === null) continue
            const n = typeof retention[key] === 'number'
                ? retention[key]
                : parseInt(String(retention[key]), 10)
            if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
                throw new Error(
                    `addPipeline: retention.${key} must be a non-negative integer for pipeline '${name}'`,
                )
            }
        }
    }

    /**
     * ADR 0012 §"Engine behavior when `source.origin` is set".
     *
     * The `source.origin` label stamps an origin string into the target's
     * `source` key column so N sibling pipelines can consolidate into one
     * target entity. Two invariants are enforced at registration so
     * misconfigurations fail before any data is written:
     *
     *   1. `source.origin` + `source.query` — materialize (query-shape) is
     *      origin-agnostic. The snapshot rebuild semantics ignore row-level
     *      discriminators.
     *   2. `source.origin` + target entity missing the `key source` element
     *      — the stamp has nowhere to land. The error points at
     *      `plugin.data_pipeline.sourced` from `cds-data-pipeline/db`.
     */
    _validateOrigin(config) {
        const source = config.source
        const origin = source && source.origin
        if (origin === undefined || origin === null) return

        const { name } = config

        if (source && source.query) {
            throw new Error(
                `addPipeline: source.origin is not supported with source.query for pipeline '${name}' — ` +
                `materialize (query-shape) rebuilds the target snapshot and is origin-agnostic. ` +
                DOC_REF_FAN_IN
            )
        }

        const targetEntity = config.target && config.target.entity
        const def = targetEntity && cds.model && cds.model.definitions && cds.model.definitions[targetEntity]
        const el = def && def.elements && def.elements.source
        const hasAspect = !!(el && el.key === true)

        if (!hasAspect) {
            throw new Error(
                `addPipeline: source.origin='${origin}' requires the target entity '${targetEntity}' ` +
                `to include the 'plugin.data_pipeline.sourced' aspect (adds 'key source : String'). ` +
                `Import it via: using { plugin.data_pipeline.sourced } from 'cds-data-pipeline/db'; ` +
                `and mix it into '${targetEntity}'. ${DOC_REF_FAN_IN}`
            )
        }
    }

    /**
     * Capability-based registration validation — ADR 0007 rows 6-8.
     * Invoked from `Pipeline.init()` after the target adapter has been
     * resolved (the source-shape invariants in `_validateConfig` above
     * are cheap enough to run before adapter resolution; the capability
     * checks are not because they need the adapter instance).
     *
     * Row 6: `mode: 'delta'` requires key-addressable UPSERT writes.
     * Row 7: `mode: 'full'` requires truncate or batch-delete support.
     * Row 8: `source.query` (query-shape snapshot write) requires batch
     *        INSERT support.
     */
    _validateTargetCapabilities(config, targetAdapter) {
        const caps = (targetAdapter && typeof targetAdapter.capabilities === 'function')
            ? targetAdapter.capabilities()
            : {}
        const { name } = config
        const adapterName = (targetAdapter && targetAdapter.constructor && targetAdapter.constructor.name) || 'TargetAdapter'

        // Row 6: delta writes need keyed UPSERT.
        if (config.mode === 'delta' && !caps.keyAddressableUpsert) {
            throw new Error(
                `addPipeline: target adapter '${adapterName}' for pipeline '${name}' ` +
                `lacks keyAddressableUpsert — delta pipelines require keyed UPSERT. ` +
                `Use mode: 'full' or pick a different target. ${DOC_REF}`
            )
        }

        // Row 7: full refresh needs truncate or batch-delete.
        if (config.mode === 'full' && !caps.truncate && !caps.batchDelete) {
            throw new Error(
                `addPipeline: target adapter '${adapterName}' for pipeline '${name}' ` +
                `cannot truncate or batch-delete — mode: 'full' requires at least one. ` +
                `${DOC_REF}`
            )
        }

        // Row 8: query-shape (snapshot write) needs batch-insert.
        if (config.source && config.source.query && !caps.batchInsert) {
            throw new Error(
                `addPipeline: target adapter '${adapterName}' for pipeline '${name}' ` +
                `lacks batchInsert — query-shape (source.query) pipelines rebuild the ` +
                `target via INSERT after the engine clears the slice. ${DOC_REF}`
            )
        }
    }

    /**
     * Source-transport level checks (unrelated to pipeline shape). The only
     * enforced invariant here is that `source.kind` — when set — refers to
     * a known adapter. Shape contradictions with `source.kind: 'cqn'` are
     * covered by `_validateConfig` rows 1 and 2 above.
     */
    _validateSource(config) {
        const { name, source } = config
        if (!source) return

        if (source.kind !== undefined && !VALID_SOURCE_KINDS.has(source.kind)) {
            throw new Error(
                `addPipeline: unknown source.kind='${source.kind}' for pipeline '${name}'. ` +
                `Expected one of: ${[...VALID_SOURCE_KINDS].join(', ')}.`
            )
        }
    }

    /**
     * Fill adapter-facing defaults. Shape-driven: the presence or absence
     * of `source.query` decides the pipeline mode, delta mode, and refresh
     * default. No derived-enum fields — dispatch runs off the source /
     * target adapter factories, not off a stored discriminator.
     */
    _normalizeConfig(config) {
        const isQueryShape = !!(config.source && config.source.query)

        const description =
            config.description !== undefined &&
            config.description !== null &&
            String(config.description).trim() !== ''
                ? String(config.description).trim()
                : null

        const normalized = {
            name: config.name,
            description,
            source: {
                batchSize: 1000,
                maxRetries: 3,
                retryDelay: 1000,
                delay: 0,
                ...config.source,
            },
            target: {
                ...config.target,
            },
            mode: config.mode || (isQueryShape ? 'full' : 'delta'),
            delta: {
                mode: isQueryShape ? 'full' : 'timestamp',
                field: 'modifiedAt',
                ...config.delta,
            },
            rest: config.rest,
            schedule: this._normalizeSchedule(config.schedule, config.name),
            viewMapping: {
                isWildcard: true,
                projectedColumns: [],
                localToRemote: {},
                remoteToLocal: {},
                excludedColumns: [],
                staticWhere: null,
                ...(config.viewMapping || {}),
            },
        }

        if (config.refresh !== undefined) {
            normalized.refresh = config.refresh
        } else if (isQueryShape) {
            normalized.refresh = 'full'
        }

        if (config.flags && typeof config.flags === 'object') {
            normalized.flags = { ...config.flags }
        }

        if (config.retention !== undefined && config.retention !== null) {
            normalized.retention = {}
            if (config.retention.retentionDays !== undefined) {
                normalized.retention.retentionDays = parseInt(String(config.retention.retentionDays), 10)
            }
            if (config.retention.maxRuns !== undefined) {
                normalized.retention.maxRuns = parseInt(String(config.retention.maxRuns), 10)
            }
        }

        const preload = this._normalizePreload(config.preload)
        if (preload) {
            normalized.preload = preload
        }

        return normalized
    }

    /**
     * Normalize `preload` into `{ wait, mode? }` or `undefined`.
     *
     *   - unset / null / false  -> `undefined` (no startup run)
     *   - true                  -> `{ wait: false }` (background initial load)
     *   - { mode?, wait? }       -> `{ wait: <bool>, mode?: <string> }`
     */
    _normalizePreload(preload) {
        if (preload === undefined || preload === null || preload === false) {
            return undefined
        }
        if (preload === true) {
            return { wait: false }
        }
        const normalized = { wait: preload.wait === true }
        if (preload.mode) {
            normalized.mode = preload.mode
        }
        return normalized
    }

    /**
     * True for a 5-field cron expression (`m h dom mon dow`, e.g. every ten
     * minutes). Cron scheduling is only supported by the queued engine (the
     * spawn engine uses a fixed `setInterval`), matching the cron form accepted
     * by CAP's Event Queues `.every(...)`.
     */
    _isCronExpression(value) {
        return typeof value === 'string' && value.trim().split(/\s+/).length === 5
    }

    /**
     * Normalize `schedule` into `{ every, engine }` or `undefined`.
     *
     * Accepted shapes:
     *   - unset / null / 0 / ''   -> `undefined` (no internal timer; external
     *                                trigger via POST /pipeline/execute is the
     *                                expected path).
     *   - number (milliseconds)    -> `{ every: <number>, engine: 'spawn' }`
     *                                (backwards-compatible default).
     *   - string ('10m')           -> `{ every, engine: 'spawn' }`.
     *   - string (cron, 5 fields)  -> `{ every, engine: 'queued' }` (cron
     *                                requires the queued engine).
     *   - { every, engine? }       -> passed through; `engine` defaults to
     *                                `'spawn'`, or `'queued'` when `every` is a
     *                                cron expression. Supported engines:
     *                                `spawn`, `queued`. Cron + explicit
     *                                `engine: 'spawn'` throws.
     */
    _normalizeSchedule(schedule, pipelineName) {
        if (schedule === undefined || schedule === null || schedule === 0 || schedule === '') {
            return undefined
        }
        if (typeof schedule === 'number') {
            return { every: schedule, engine: 'spawn' }
        }
        if (typeof schedule === 'string') {
            // Cron expressions can only be honored by the queued engine.
            const engine = this._isCronExpression(schedule) ? 'queued' : 'spawn'
            return { every: schedule, engine }
        }
        if (typeof schedule === 'object') {
            const isCron = this._isCronExpression(schedule.every)
            const engine = schedule.engine || (isCron ? 'queued' : 'spawn')
            if (engine !== 'spawn' && engine !== 'queued') {
                throw new Error(
                    `addPipeline: unknown schedule.engine='${engine}' for pipeline '${pipelineName}'. ` +
                    `Expected 'spawn' or 'queued'.`
                )
            }
            if (schedule.every === undefined || schedule.every === null) {
                throw new Error(
                    `addPipeline: schedule.every is required when schedule is an object ` +
                    `for pipeline '${pipelineName}'.`
                )
            }
            if (engine === 'spawn' && isCron) {
                throw new Error(
                    `addPipeline: cron expression '${schedule.every}' for pipeline '${pipelineName}' ` +
                    `requires schedule.engine='queued'. The 'spawn' engine only supports fixed ` +
                    `intervals (milliseconds / time strings).`
                )
            }
            return { every: schedule.every, engine }
        }
        throw new Error(
            `addPipeline: invalid schedule for pipeline '${pipelineName}'. ` +
            `Expected a number (ms), a string ('10m'), or { every, engine? }.`
        )
    }
}

module.exports = DataPipelineService
