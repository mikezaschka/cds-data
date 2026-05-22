const cds = require('@sap/cds')
const DataReplication = require('./lib/DataReplication')

const LOG = cds.log('cds-data-federation')

const PIPELINE_EVENTS = ['REPLICATE.READ', 'REPLICATE.MAP', 'REPLICATE.WRITE']

/**
 * CDS service that orchestrates configured replications.
 *
 * Extends `cds.Service` so the READ → MAP → WRITE pipeline runs through
 * CAP's native event dispatch. The pipeline uses namespaced events
 * (`REPLICATE.READ`, `REPLICATE.MAP`, `REPLICATE.WRITE`) to avoid collision
 * with CAP's CRUD aliases (`READ`, `WRITE` → CREATE+UPSERT+UPDATE).
 *
 * Defaults per replication are stored in internal maps and invoked from a
 * single service-level `on()` router. User hooks registered via the standard
 * CAP `srv.before(event, path, handler)` / `srv.after(event, path, handler)`
 * API compose with defaults through CAP's native before → on → after chain.
 */
class DataReplicationService extends cds.Service {

    async init() {
        this.replications = new Map()

        // Per-replication default handlers keyed by replication name.
        this._defaults = Object.fromEntries(
            PIPELINE_EVENTS.map(e => [e, new Map()])
        )

        // A single catch-all router for each pipeline event. Looks up the
        // default handler registered for `req.data.replication` and invokes
        // it; if no default is registered, calls `next()` so user-provided
        // `on` handlers can still supply the behavior.
        for (const event of PIPELINE_EVENTS) {
            this.on(event, (req, next) => this._route(event, req, next))
        }

        await super.init()
    }

    async addReplication(config) {
        const { name } = config
        if (this.replications.has(name)) {
            throw new Error(`Replication configuration '${name}' already exists`)
        }

        const internalConfig = this._normalizeConfig(config)

        try {
            const replication = new DataReplication(name, internalConfig, this)
            await replication.init()
            this.replications.set(name, replication)

            if (internalConfig.schedule) {
                this._scheduleJob(name, internalConfig.schedule)
            }

            LOG._info && LOG.info(`Added replication: ${name}`)
        } catch (err) {
            LOG._error && LOG.error(`Failed to add replication ${name}:`, err)
            throw err
        }

        return this
    }

    /**
     * Public API:  `srv.run(name, mode?, trigger?)` — triggers a replication.
     * Framework:   `srv.run(fn)` / `srv.run(query)` — CAP's transactional
     *              wrapper; delegates to the base class so `srv.dispatch()`
     *              continues to work.
     */
    run(first, mode = 'delta', trigger = 'manual') {
        if (typeof first === 'string') {
            return this._runReplication(first, mode, trigger)
        }
        return super.run(...arguments)
    }

    async _runReplication(name, mode, trigger) {
        const replication = this.replications.get(name)
        if (!replication) {
            throw new Error(`Unknown replication: ${name}`)
        }
        await replication.execute(mode, trigger)
    }

    async getStatus(name) {
        const replication = this.replications.get(name)
        if (!replication) {
            throw new Error(`Unknown replication: ${name}`)
        }
        return replication.getStatus()
    }

    async clear(name) {
        const replication = this.replications.get(name)
        if (!replication) {
            throw new Error(`Unknown replication: ${name}`)
        }
        await replication.clear()
    }

    /**
     * Register an internal default handler for a pipeline phase.
     * Called by `DataReplication.init()` — not part of the public API.
     */
    registerDefault(event, replicationName, handler) {
        const bucket = this._defaults[event]
        if (!bucket) {
            throw new Error(`Unknown pipeline event '${event}'`)
        }
        bucket.set(replicationName, handler)
    }

    _route(event, req, next) {
        const replicationName = req.data && req.data.replication
        const handler = replicationName && this._defaults[event].get(replicationName)
        if (handler) return handler(req)
        return typeof next === 'function' ? next() : undefined
    }

    _scheduleJob(name, everyMs) {
        const interval = typeof everyMs === 'number' ? everyMs : parseInt(everyMs, 10)
        if (!interval || interval <= 0) {
            LOG.warn(`Invalid schedule for '${name}': ${everyMs}`)
            return
        }
        cds.spawn({ every: interval }, async () => {
            try {
                await this.run(name, 'delta', 'scheduled')
            } catch (err) {
                LOG._error && LOG.error(`Scheduled replication failed for ${name}:`, err)
            }
        })
    }

    _normalizeConfig(config) {
        return {
            name: config.name,
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
            mode: config.mode || 'delta',
            delta: {
                mode: 'timestamp',
                field: 'modifiedAt',
                ...config.delta,
            },
            rest: config.rest,
            schedule: config.schedule,
            viewMapping: config.viewMapping || {
                isWildcard: true,
                projectedColumns: [],
                localToRemote: {},
                remoteToLocal: {},
            },
        }
    }
}

module.exports = DataReplicationService
