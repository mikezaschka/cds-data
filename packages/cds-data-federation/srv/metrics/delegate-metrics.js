const cds = require('@sap/cds')
// Canonical CDS 9/10 affected-count normalization. Deep-imported rather than
// copied: duplicating version-specific behaviour is how the two drift apart,
// and cds-data-pipeline is a hard peer dependency.
const { rowsAffected } = require('cds-data-pipeline/srv/lib/rowsAffected')

const LOG = cds.log('cds-data-federation')

const METRICS = 'plugin.data_federation.DelegateMetrics'
const SETTINGS = 'plugin.data_federation.FederationSettings'
const SETTINGS_ID = 'default'

const DEFAULT_INTERVAL_MS = 60_000
const DEFAULT_RETENTION_DAYS = 30

/**
 * Per-entity counters for the delegate path — ADR 0019.
 *
 * Accumulates in the process and flushes to `DelegateMetrics` on an interval,
 * so a delegated read costs a counter increment and a timestamp delta rather
 * than a database write.
 *
 * Off unless `requires.data-federation.metrics.enabled` is true. With the flag
 * off nothing here allocates: `instrument()` hands the original handler back
 * untouched, so the delegate path is exactly what it was.
 */

/** servedKey (`Service.Entity`) → consumption-view FQN */
const _entityByServedKey = new Map()

/** entityFullName → accumulator */
let _pending = new Map()

let _timer = null

/**
 * Whether counters are being written right now. Distinct from `isEnabled()`:
 * that decides whether handlers are instrumented at all, and is fixed at
 * startup. This one is the operator's pause switch, and it persists.
 */
let _collecting = null

function config() {
    return cds.env?.requires?.['data-federation']?.metrics || {}
}

/** Whether metrics are configured at all — decides instrumentation. */
function isEnabled() {
    return config().enabled === true
}

/**
 * Whether counters are actually being recorded. Configuration seeds it; a
 * persisted override wins, per ADR 0019 and the precedence cds-caching uses.
 */
function isCollecting() {
    if (!isEnabled()) return false
    return _collecting !== null ? _collecting : true
}

/** Read the persisted override once at startup. */
async function loadOverride() {
    if (!isEnabled()) return
    try {
        const row = await SELECT.one.from(SETTINGS).where({ id: SETTINGS_ID })
        _collecting = row && row.metricsEnabled !== null && row.metricsEnabled !== undefined
            ? !!row.metricsEnabled
            : null
    } catch (err) {
        LOG.warn('delegate metrics: could not read the settings override:', err.message)
    }
}

/**
 * Pause or resume collection, or pass null to fall back to configuration.
 * Flushes what is pending first, so pausing does not discard counts already
 * gathered.
 *
 * @param {boolean|null} enabled
 */
async function setCollecting(enabled) {
    if (!isEnabled()) {
        throw new Error(
            'Delegate metrics are not configured — set requires.data-federation.metrics.enabled. '
            + 'A runtime switch can pause collection, not instrument the handlers.',
        )
    }
    const value = enabled === null || enabled === undefined ? null : !!enabled
    await flush().catch(() => {})
    const affected = await UPDATE(SETTINGS).set({ metricsEnabled: value }).where({ id: SETTINGS_ID })
    if (rowsAffected(affected) === 0) {
        await INSERT.into(SETTINGS).entries({ id: SETTINGS_ID, metricsEnabled: value })
    }
    _collecting = value
    return isCollecting()
}

/** Called at handler registration so the hot path never resolves names. */
function mapEntity(serviceName, entityName, entityFullName) {
    _entityByServedKey.set(`${serviceName}.${entityName}`, entityFullName)
}

function resolveEntity(serviceName, entityName) {
    return _entityByServedKey.get(`${serviceName}.${entityName}`) || `${serviceName}.${entityName}`
}

function blank() {
    return {
        requests: 0,
        errors: 0,
        writes: 0,
        writeErrors: 0,
        latencySumMs: 0,
        minLatency: null,
        maxLatency: null,
    }
}

/**
 * @param {string} entity consumption-view FQN
 * @param {'read'|'write'} kind
 * @param {number} ms elapsed
 * @param {boolean} ok
 */
function record(entity, kind, ms, ok) {
    if (!isCollecting()) return
    let acc = _pending.get(entity)
    if (!acc) {
        acc = blank()
        _pending.set(entity, acc)
    }
    if (kind === 'write') {
        acc.writes += 1
        if (!ok) acc.writeErrors += 1
    } else {
        acc.requests += 1
        if (!ok) acc.errors += 1
    }
    // Latency covers both kinds: it is time spent waiting on the remote.
    acc.latencySumMs += ms
    if (acc.minLatency === null || ms < acc.minLatency) acc.minLatency = ms
    if (acc.maxLatency === null || ms > acc.maxLatency) acc.maxLatency = ms
}

/**
 * Wrap a CAP handler so its remote round trip is counted.
 *
 * Returns the handler unchanged when metrics are off, so there is no wrapper
 * frame, no timer and no allocation on the request path.
 *
 * @param {object} service the serving CAP service
 * @param {string} entityName entity name within that service
 * @param {'read'|'write'} kind
 * @param {Function} handler
 * @returns {Function}
 */
function instrument(service, entityName, kind, handler) {
    if (!isEnabled()) return handler
    const entity = resolveEntity(service.name, entityName)
    return async function instrumented(req) {
        const started = Date.now()
        try {
            const result = await handler.call(this, req)
            record(entity, kind, Date.now() - started, true)
            return result
        } catch (err) {
            record(entity, kind, Date.now() - started, false)
            throw err
        }
    }
}

/** `hourly:2026-09-20T14` — the convention cds-caching already uses. */
function currentBucket(now = new Date()) {
    return `hourly:${now.toISOString().slice(0, 13)}`
}

/**
 * Write the accumulated counters out and reset.
 *
 * ADR 0019 §5: one shared row per (bucket, entity). Additive columns use an
 * atomic increment, so concurrent instances cannot lose updates; min and max
 * use a compare-and-set guard, which avoids a scalar `MIN(a,b)` whose spelling
 * differs by dialect. The row may not exist, and two instances may both find it
 * missing, so an INSERT that loses the race falls back to the UPDATE.
 */
async function flush(now = new Date()) {
    if (_pending.size === 0) return { rows: 0 }
    const batch = _pending
    _pending = new Map()
    const bucket = currentBucket(now)

    let written = 0
    for (const [entity, acc] of batch) {
        try {
            await writeOne(bucket, entity, acc)
            written += 1
        } catch (err) {
            // Never lose traffic counts to a transient write failure: fold the
            // batch back so the next flush retries it.
            foldBack(entity, acc)
            LOG.warn(`delegate metrics: flush failed for '${entity}':`, err.message)
        }
    }
    return { rows: written }
}

async function writeOne(bucket, entity, acc) {
    const key = { bucket, entity }
    const incremented = await incrementAdditive(key, acc)
    if (rowsAffected(incremented) === 0) {
        try {
            await INSERT.into(METRICS).entries({
                ...key,
                requests: acc.requests,
                errors: acc.errors,
                writes: acc.writes,
                writeErrors: acc.writeErrors,
                latencySumMs: acc.latencySumMs,
                minLatency: acc.minLatency,
                maxLatency: acc.maxLatency,
            })
            return
        } catch {
            // Another instance inserted the row first. Increment onto theirs.
            await incrementAdditive(key, acc)
        }
    }
    await mergeExtremes(key, acc)
}

function incrementAdditive(key, acc) {
    return UPDATE(METRICS)
        .set({
            requests: { '+=': acc.requests },
            errors: { '+=': acc.errors },
            writes: { '+=': acc.writes },
            writeErrors: { '+=': acc.writeErrors },
            latencySumMs: { '+=': acc.latencySumMs },
        })
        .where(key)
}

async function mergeExtremes({ bucket, entity }, acc) {
    // Tagged-template `where` on purpose: an object predicate cannot express
    // the parenthesised OR this needs. `{ ...key, or: [...] }` compiles to
    // `bucket = ? and entity = ? or ...` with no grouping, which updates rows
    // it was never meant to touch.
    if (acc.minLatency !== null) {
        const min = acc.minLatency
        await UPDATE(METRICS)
            .set({ minLatency: min })
            .where`bucket = ${bucket} and entity = ${entity} and (minLatency is null or minLatency > ${min})`
    }
    if (acc.maxLatency !== null) {
        const max = acc.maxLatency
        await UPDATE(METRICS)
            .set({ maxLatency: max })
            .where`bucket = ${bucket} and entity = ${entity} and (maxLatency is null or maxLatency < ${max})`
    }
}

/** Merge an unwritten batch entry back into the live accumulator. */
function foldBack(entity, acc) {
    const live = _pending.get(entity)
    if (!live) {
        _pending.set(entity, acc)
        return
    }
    live.requests += acc.requests
    live.errors += acc.errors
    live.writes += acc.writes
    live.writeErrors += acc.writeErrors
    live.latencySumMs += acc.latencySumMs
    if (acc.minLatency !== null && (live.minLatency === null || acc.minLatency < live.minLatency)) {
        live.minLatency = acc.minLatency
    }
    if (acc.maxLatency !== null && (live.maxLatency === null || acc.maxLatency > live.maxLatency)) {
        live.maxLatency = acc.maxLatency
    }
}

/** Drop buckets older than the retention window (ADR 0014's policy shape). */
async function sweep(now = new Date()) {
    const days = config().retention?.days ?? DEFAULT_RETENTION_DAYS
    if (!days || days <= 0) return { deleted: 0 }
    const cutoff = new Date(now.getTime() - days * 86_400_000)
    const affected = await DELETE.from(METRICS).where({
        bucket: { '<': `hourly:${cutoff.toISOString().slice(0, 13)}` },
    })
    return { deleted: rowsAffected(affected) }
}

function start() {
    if (!isEnabled() || _timer) return
    const interval = config().persistenceInterval ?? DEFAULT_INTERVAL_MS
    _timer = setInterval(async () => {
        try {
            await flush()
            await sweep()
        } catch (err) {
            LOG.warn('delegate metrics: flush cycle failed:', err.message)
        }
    }, interval)
    _timer.unref?.()
    LOG._info && LOG.info(`Delegate metrics enabled (flush every ${interval}ms)`)
}

function stop() {
    if (_timer) clearInterval(_timer)
    _timer = null
}

/** Test seam: drop in-memory state without touching the database. */
function _reset() {
    _pending = new Map()
    _entityByServedKey.clear()
    _collecting = null
    stop()
}

module.exports = {
    isEnabled,
    isCollecting,
    loadOverride,
    setCollecting,
    SETTINGS,
    mapEntity,
    resolveEntity,
    instrument,
    record,
    flush,
    sweep,
    start,
    stop,
    currentBucket,
    METRICS,
    _pending: () => _pending,
    _reset,
}
