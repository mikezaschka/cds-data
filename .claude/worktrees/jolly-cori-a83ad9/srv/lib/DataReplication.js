const cds = require('@sap/cds')
const { createAdapter } = require('../adapters/factory')

const LOG = cds.log('cds-data-federation')
const FEDERATIONS = 'plugin_data_federation_Federations'
const RUNS = 'plugin_data_federation_ReplicationRuns'

/**
 * Per-replication execution engine.
 *
 * Drives the READ → MAP → WRITE pipeline by constructing `cds.Request`
 * instances and dispatching them through the parent `DataReplicationService`.
 * Default per-phase handlers are registered on the parent service and invoked
 * via its internal router; user-facing hooks (`before.REPLICATE.MAP`,
 * `after.REPLICATE.WRITE`, …) compose through CAP's native handler chain.
 */
class DataReplication {
    constructor(name, config, srv) {
        this.name = name
        this.config = config
        this.srv = srv
    }

    async init() {
        this.srv.registerDefault('REPLICATE.READ', this.name, (req) => this._defaultReadHandler(req))
        this.srv.registerDefault('REPLICATE.MAP', this.name, (req) => this._defaultMapHandler(req))
        this.srv.registerDefault('REPLICATE.WRITE', this.name, (req) => this._defaultWriteHandler(req))

        await this._ensureTracker()
        LOG._info && LOG.info(`Initialized replication: ${this.name}`)
    }

    // ─── Execution ──────────────────────────────────────────────────────────────

    async execute(mode = 'delta', trigger = 'manual') {
        const affected = await UPDATE(FEDERATIONS)
            .set({ status: 'running' })
            .where({ name: this.name, status: { '!=': 'running' } })

        if (affected === 0) {
            LOG.warn(`Replication '${this.name}' already running, skipping.`)
            return
        }

        const runId = cds.utils.uuid()
        try {
            await INSERT.into(RUNS).entries({
                ID: runId,
                tracker_name: this.name,
                status: 'running',
                startTime: new Date().toISOString(),
                trigger,
                mode,
                statistics_created: 0,
                statistics_updated: 0,
                statistics_deleted: 0,
            })

            const stats = mode === 'full'
                ? await this._fullSync()
                : await this._deltaSync()

            await UPDATE(RUNS).set({
                status: 'completed',
                endTime: new Date().toISOString(),
                statistics_created: stats.created,
                statistics_updated: stats.updated,
                statistics_deleted: stats.deleted,
            }).where({ ID: runId })

            await UPDATE(FEDERATIONS).set({
                status: 'idle',
                lastSync: new Date().toISOString(),
                statistics_created: { '+=': stats.created },
                statistics_updated: { '+=': stats.updated },
                statistics_deleted: { '+=': stats.deleted },
            }).where({ name: this.name })

        } catch (err) {
            LOG._error && LOG.error(`Replication failed for ${this.name}:`, err)

            if (runId) {
                await UPDATE(RUNS).set({
                    status: 'failed',
                    endTime: new Date().toISOString(),
                    error: JSON.stringify({ message: err.message }),
                }).where({ ID: runId })
            }

            await UPDATE(FEDERATIONS).set({
                status: 'failed',
                errorCount: { '+=': 1 },
                lastError: err.message,
            }).where({ name: this.name })

            throw err
        }
    }

    async _fullSync() {
        const db = await cds.connect.to('db')
        await db.run(DELETE.from(this.config.target.entity))

        await UPDATE(FEDERATIONS)
            .set({ lastSync: null, lastKey: null })
            .where({ name: this.name })

        return this._deltaSync()
    }

    async _deltaSync() {
        const stats = { created: 0, updated: 0, deleted: 0 }

        // ── READ phase ──
        const readReq = this._makeReq('REPLICATE.READ', {
            config: this.config,
            source: this.config.source,
            target: this.config.target,
        })
        await this.srv.dispatch(readReq)

        const sourceStream = readReq.data.sourceStream
        if (!sourceStream) {
            LOG.warn(`No source stream produced for '${this.name}'`)
            return stats
        }

        // ── Process batches ──
        for await (const batch of sourceStream) {
            // ── MAP phase ──
            const mapReq = this._makeReq('REPLICATE.MAP', {
                config: this.config,
                source: this.config.source,
                target: this.config.target,
                sourceRecords: batch,
                targetRecords: [],
            })
            await this.srv.dispatch(mapReq)

            const records = mapReq.data.targetRecords
            if (!records || records.length === 0) continue

            // ── WRITE phase ──
            const writeReq = this._makeReq('REPLICATE.WRITE', {
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
        }

        LOG._info && LOG.info(`Replicated ${stats.created} records for '${this.name}'`)
        return stats
    }

    /**
     * Construct a request for the pipeline. Sets `req.reply` before dispatch
     * to force interceptor-chain semantics on CAP's `on` handlers (without
     * it, CAP runs `on` handlers in parallel rather than as a chain with
     * `next()` fall-through). Path uses the plugin convention
     * `${srv.name}.${replicationName}` so user-registered
     * `before/after(event, replicationName, handler)` hooks match via CAP's
     * native path matcher.
     */
    _makeReq(event, data) {
        const req = new cds.Request({
            event,
            path: `${this.srv.name}.${this.name}`,
            data: { replication: this.name, ...data },
        })
        req.reply = (x) => { req.results = x }
        return req
    }

    // ─── Default handlers ───────────────────────────────────────────────────────

    async _defaultReadHandler(req) {
        const config = req.data.config || this.config
        const tracker = await this._getTracker()
        const adapter = await createAdapter(config)
        req.data.sourceStream = adapter.readStream(tracker)
    }

    async _defaultMapHandler(req) {
        const records = req.data.sourceRecords
        const config = req.data.config || this.config
        const viewMapping = config.viewMapping || { remoteToLocal: {} }
        const { remoteToLocal } = viewMapping
        const hasRenames = remoteToLocal && Object.keys(remoteToLocal).length > 0

        req.data.targetRecords = hasRenames
            ? records.map(rec => {
                const mapped = {}
                for (const [key, val] of Object.entries(rec)) {
                    mapped[remoteToLocal[key] || key] = val
                }
                return mapped
            })
            : records.map(rec => ({ ...rec }))
    }

    async _defaultWriteHandler(req) {
        const records = req.data.targetRecords
        const config = req.data.config || this.config
        const targetEntity = (req.data.target && req.data.target.entity) || config.target.entity

        const db = await cds.connect.to('db')
        await db.run(UPSERT.into(targetEntity).entries(records))

        req.data.statistics = {
            created: records.length,
            updated: 0,
            deleted: 0,
        }
    }

    // ─── Tracker management ─────────────────────────────────────────────────────

    async _ensureTracker() {
        const existing = await SELECT.one.from(FEDERATIONS).where({ name: this.name })
        if (!existing) {
            await INSERT.into(FEDERATIONS).entries({
                name: this.name,
                strategy: this.config.strategy || 'replicate',
                source: JSON.stringify(this.config.source),
                target: JSON.stringify(this.config.target),
                mode: this.config.mode,
                status: 'idle',
                errorCount: 0,
                statistics_created: 0,
                statistics_updated: 0,
                statistics_deleted: 0,
            })
        } else if (!existing.strategy && this.config.strategy) {
            // Backfill strategy for rows created by earlier plugin versions
            await UPDATE(FEDERATIONS).set({ strategy: this.config.strategy })
                .where({ name: this.name })
        }
    }

    async _getTracker() {
        return SELECT.one.from(FEDERATIONS).where({ name: this.name })
    }

    async clear() {
        const db = await cds.connect.to('db')
        await db.run(DELETE.from(this.config.target.entity))
        await UPDATE(FEDERATIONS).set({
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

module.exports = DataReplication
