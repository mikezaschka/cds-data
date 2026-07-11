/**
 * Normalize cds.requires data-pipeline entries (management.reuse.*).
 * Mirrors cds-caching lib/config-normalizer.js.
 */

const PLUGIN_IMPL = 'cds-data-pipeline'

/** Default daily interval when housekeeping is enabled but schedule is omitted. */
const DEFAULT_HOUSEKEEPING_SCHEDULE = { every: 86400000, engine: 'spawn' }

/**
 * @param {unknown} value
 * @returns {number|undefined}
 */
function normalizeRetentionInt(value) {
    if (value === undefined || value === null || value === '') return undefined
    const n = typeof value === 'number' ? value : parseInt(String(value), 10)
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return undefined
    return n
}

/**
 * @param {object} [raw={}]
 * @returns {{ enabled: boolean, retentionDays?: number, maxRuns?: number, schedule?: object|string|number }}
 */
function normalizeHousekeepingBlock(raw = {}) {
    if (!raw || typeof raw !== 'object') {
        return { enabled: false }
    }
    const retentionDays = normalizeRetentionInt(raw.retentionDays)
    const maxRuns = normalizeRetentionInt(raw.maxRuns)
    const enabled = retentionDays !== undefined || maxRuns !== undefined
    if (!enabled) {
        return { enabled: false }
    }
    const schedule =
        raw.schedule !== undefined && raw.schedule !== null && raw.schedule !== ''
            ? raw.schedule
            : DEFAULT_HOUSEKEEPING_SCHEDULE
    return { enabled: true, retentionDays, maxRuns, schedule }
}

/**
 * @param {object} [raw={}]
 * @returns {{ impl?: string, management: object|null, reuse: { api: boolean, console: boolean }, inspect: boolean, housekeeping: ReturnType<typeof normalizeHousekeepingBlock>, raw: object }}
 */
function normalizePipelineConfig(raw = {}) {
    let management = raw.management ? { ...raw.management } : null
    let reuse = {
        api: management?.reuse?.api === true,
        console: management?.reuse?.console === true,
    }

    if (management?.reuse) {
        if (management.reuse.api === true) reuse.api = true
        if (management.reuse.console === true) reuse.console = true
    }

    if (reuse.console) {
        reuse.api = true
    }

    const inspect = management?.inspect !== false

    if (management) {
        management = { ...management, reuse: { ...reuse }, inspect }
    } else if (reuse.api || reuse.console) {
        management = { reuse: { ...reuse }, inspect }
    }

    return {
        impl: raw.impl,
        management,
        reuse,
        inspect: management?.inspect ?? true,
        housekeeping: normalizeHousekeepingBlock(raw.housekeeping),
        raw,
    }
}

/**
 * Global run-retention defaults from `cds.requires` entries with
 * `impl: 'cds-data-pipeline'`. The first enabled `housekeeping` block wins.
 *
 * @param {object} [requires={}]
 * @returns {ReturnType<typeof normalizeHousekeepingBlock>}
 */
function getHousekeepingConfig(requires = {}) {
    for (const entry of getPipelineRequiresEntries(requires)) {
        const hk = entry.normalized.housekeeping
        if (hk && hk.enabled) return hk
    }
    return { enabled: false }
}

/**
 * @param {object} [requires={}]
 * @returns {Array<{ name: string, normalized: ReturnType<typeof normalizePipelineConfig> }>}
 */
function getPipelineRequiresEntries(requires = {}) {
    return Object.entries(requires)
        .filter(([, config]) => config?.impl === PLUGIN_IMPL)
        .map(([name, config]) => ({
            name,
            normalized: normalizePipelineConfig(config),
        }))
}

/**
 * @param {ReturnType<typeof normalizePipelineConfig>} normalized
 * @returns {boolean}
 */
function isManagementConfigured(normalized) {
    return normalized.management != null
}

/**
 * Whether pipeline data inspection is enabled for the configured plugin entry/entries.
 * Defaults to true when no `cds-data-pipeline` requires entry is present.
 *
 * @param {object} [requires={}]
 * @returns {boolean}
 */
function isManagementInspectEnabled(requires = {}) {
    const entries = getPipelineRequiresEntries(requires)
    if (!entries.length) return true
    return entries.every((entry) => entry.normalized.inspect !== false)
}

module.exports = {
    PLUGIN_IMPL,
    DEFAULT_HOUSEKEEPING_SCHEDULE,
    normalizeRetentionInt,
    normalizeHousekeepingBlock,
    normalizePipelineConfig,
    getPipelineRequiresEntries,
    getHousekeepingConfig,
    isManagementConfigured,
    isManagementInspectEnabled,
}
