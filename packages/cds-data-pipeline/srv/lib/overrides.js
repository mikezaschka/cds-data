/**
 * Pipeline config overrides: allowlist, merge, serialize/parse, config view.
 *
 * Coded `addPipeline(config)` is the baseline. Persisted overrides layer on
 * top → effective config. See docs/pipeline/guide/concepts/overrides.md.
 */

const LOG = require('../runtime-cds').log('cds-data-pipeline')

/**
 * Top-level and nested paths that may be set via setOverrides / setSchedule /
 * setEnabled. Anything else is rejected.
 */
const OVERRIDABLE_PATHS = [
    'enabled',
    'mode',
    'schedule',
    'retention',
    'retention.retentionDays',
    'retention.maxRuns',
    'delta',
    'delta.mode',
    'delta.field',
    'delta.dateField',
    'delta.timeField',
    'source.batchSize',
    'source.delay',
    'source.maxRetries',
    'source.retryDelay',
    'flags',
    'description',
]

const OVERRIDABLE_TOP = new Set(['enabled', 'mode', 'schedule', 'retention', 'delta', 'source', 'flags', 'description'])
const OVERRIDABLE_SOURCE = new Set(['batchSize', 'delay', 'maxRetries', 'retryDelay'])
const OVERRIDABLE_DELTA = new Set(['mode', 'field', 'dateField', 'timeField'])
const OVERRIDABLE_RETENTION = new Set(['retentionDays', 'maxRuns'])

const SERIALIZABLE_BASE_KEYS = [
    'name',
    'description',
    'mode',
    'schedule',
    'retention',
    'delta',
    'source',
    'target',
    'rest',
    'flags',
    'viewMapping',
    'refresh',
    'preload',
]

/**
 * Deep-clone plain JSON-ish values. Functions become `'[Function]'`.
 */
function safeClone(value, seen = new WeakSet()) {
    if (value === null || value === undefined) return value
    if (typeof value === 'function') return '[Function]'
    if (typeof value !== 'object') return value
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    if (Array.isArray(value)) {
        return value.map((v) => safeClone(v, seen))
    }
    const out = {}
    for (const [k, v] of Object.entries(value)) {
        out[k] = safeClone(v, seen)
    }
    return out
}

/**
 * Serializable slice of the coded baseline for the tracker `baseConfig` column.
 * Drops closures (`source.query`, `refresh.slice`, adapters).
 */
function serializeBaseConfig(config) {
    const base = {}
    for (const key of SERIALIZABLE_BASE_KEYS) {
        if (config[key] === undefined) continue
        base[key] = safeClone(config[key])
    }
    if (base.source && typeof base.source === 'object') {
        const src = { ...base.source }
        delete src.query
        delete src.adapter
        base.source = src
    }
    if (base.refresh && typeof base.refresh === 'object') {
        const refresh = { ...base.refresh }
        if (typeof refresh.slice === 'function') refresh.slice = '[Function]'
        base.refresh = refresh
    }
    if (base.target && typeof base.target === 'object') {
        const tgt = { ...base.target }
        delete tgt.adapter
        base.target = tgt
    }
    // Coded baseline always starts enabled unless overridden.
    if (base.enabled === undefined) base.enabled = true
    return base
}

function parseOverridesJson(raw) {
    if (raw == null || raw === '') return {}
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        return parsed
    } catch (err) {
        LOG.warn('Failed to parse pipeline overrides JSON:', err.message)
        return {}
    }
}

/**
 * Shallow-deep merge for override application. Arrays and non-plain objects
 * are replaced, not concatenated. `undefined` in patch deletes the key from
 * the result (used by clearOverrides via deletePath).
 */
function deepMerge(base, patch) {
    if (patch === null || patch === undefined) return safeClone(base)
    if (typeof patch !== 'object' || Array.isArray(patch)) return safeClone(patch)
    if (typeof base !== 'object' || base === null || Array.isArray(base)) {
        return deepMerge({}, patch)
    }
    const out = { ...base }
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) {
            delete out[k]
            continue
        }
        if (v !== null && typeof v === 'object' && !Array.isArray(v)
            && out[k] !== null && typeof out[k] === 'object' && !Array.isArray(out[k])) {
            out[k] = deepMerge(out[k], v)
        } else {
            out[k] = safeClone(v)
        }
    }
    return out
}

/**
 * Validate an overrides patch against the allowlist. Throws on forbidden keys.
 * Returns a cleaned patch (only allowlisted paths).
 */
function validateOverridesPatch(patch, { forClear = false } = {}) {
    if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('overrides must be a plain object')
    }
    const cleaned = {}
    for (const [key, value] of Object.entries(patch)) {
        if (!OVERRIDABLE_TOP.has(key)) {
            throw new Error(
                `Override key '${key}' is not overridable. ` +
                `Allowed: ${[...OVERRIDABLE_TOP].join(', ')}. ` +
                `Structural fields (source.entity/service/kind, target, viewMapping, query) cannot be overridden.`
            )
        }
        if (key === 'source') {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                throw new Error("overrides.source must be an object with batchSize/delay/maxRetries/retryDelay")
            }
            const src = {}
            for (const [sk, sv] of Object.entries(value)) {
                if (!OVERRIDABLE_SOURCE.has(sk)) {
                    throw new Error(
                        `Override key 'source.${sk}' is not overridable. ` +
                        `Allowed source knobs: ${[...OVERRIDABLE_SOURCE].join(', ')}.`
                    )
                }
                src[sk] = sv
            }
            cleaned.source = src
            continue
        }
        if (key === 'delta') {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                throw new Error('overrides.delta must be an object')
            }
            const delta = {}
            for (const [dk, dv] of Object.entries(value)) {
                if (!OVERRIDABLE_DELTA.has(dk)) {
                    throw new Error(
                        `Override key 'delta.${dk}' is not overridable. ` +
                        `Allowed: ${[...OVERRIDABLE_DELTA].join(', ')}.`
                    )
                }
                delta[dk] = dv
            }
            cleaned.delta = delta
            continue
        }
        if (key === 'enabled') {
            if (typeof value !== 'boolean') {
                throw new Error('overrides.enabled must be a boolean')
            }
            cleaned.enabled = value
            continue
        }
        if (key === 'mode') {
            if (value !== 'delta' && value !== 'full' && value !== 'partial-refresh') {
                throw new Error("overrides.mode must be 'delta', 'full', or 'partial-refresh'")
            }
            cleaned.mode = value
            continue
        }
        if (key === 'schedule') {
            // null clears schedule override (falls back to coded); object/number/string set it
            cleaned.schedule = value
            continue
        }
        if (key === 'retention') {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                throw new Error('overrides.retention must be an object or null')
            }
            const retention = {}
            for (const [rk, rv] of Object.entries(value)) {
                if (!OVERRIDABLE_RETENTION.has(rk)) {
                    throw new Error(
                        `Override key 'retention.${rk}' is not overridable. ` +
                        `Allowed: ${[...OVERRIDABLE_RETENTION].join(', ')}.`
                    )
                }
                if (rv !== undefined && rv !== null) {
                    const n = typeof rv === 'number' ? rv : parseInt(String(rv), 10)
                    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
                        throw new Error(`overrides.retention.${rk} must be a non-negative integer`)
                    }
                    retention[rk] = n
                }
            }
            cleaned.retention = retention
            continue
        }
        if (key === 'flags') {
            if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
                throw new Error('overrides.flags must be an object or null')
            }
            cleaned.flags = value
            continue
        }
        if (key === 'description') {
            cleaned.description = value
            continue
        }
        if (!forClear) cleaned[key] = value
    }
    return cleaned
}

/**
 * Delete dotted or top-level keys from an overrides object (mutates a clone).
 * @param {object} overrides
 * @param {string[]} keys  e.g. ['schedule', 'source.batchSize', 'delta']
 */
function clearOverrideKeys(overrides, keys) {
    const out = safeClone(overrides) || {}
    for (const key of keys) {
        if (!key || typeof key !== 'string') continue
        const parts = key.split('.')
        if (parts.length === 1) {
            delete out[parts[0]]
            continue
        }
        let cur = out
        for (let i = 0; i < parts.length - 1; i++) {
            if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') {
                cur = null
                break
            }
            cur = cur[parts[i]]
        }
        if (cur) delete cur[parts[parts.length - 1]]
        // Drop empty nested objects
        if (parts[0] === 'source' && out.source && Object.keys(out.source).length === 0) delete out.source
        if (parts[0] === 'delta' && out.delta && Object.keys(out.delta).length === 0) delete out.delta
    }
    return out
}

/**
 * Apply overrides onto a live base config. Preserves closures/adapters from
 * base that cannot live in JSON (by merging into a shallow copy of base).
 */
function applyOverrides(baseConfig, overrides) {
    const enabledDefault = { enabled: true }
    const withDefaults = { ...enabledDefault, ...baseConfig }
    if (!overrides || Object.keys(overrides).length === 0) {
        return withDefaults
    }
    // Merge into a clone of base so we keep functions (query, slice, adapters).
    const effective = { ...withDefaults }
    for (const [key, value] of Object.entries(overrides)) {
        if (key === 'source' && value && typeof value === 'object') {
            effective.source = { ...(withDefaults.source || {}), ...value }
            continue
        }
        if (key === 'delta' && value && typeof value === 'object') {
            effective.delta = { ...(withDefaults.delta || {}), ...value }
            continue
        }
        if (key === 'retention' && value && typeof value === 'object') {
            effective.retention = { ...(withDefaults.retention || {}), ...value }
            continue
        }
        if (key === 'flags' && value && typeof value === 'object') {
            effective.flags = { ...(withDefaults.flags || {}), ...value }
            continue
        }
        if (key === 'schedule' && value === null) {
            delete effective.schedule
            continue
        }
        effective[key] = value
    }
    return effective
}

/**
 * Build the configView payload for API / console.
 *
 * @param {object} opts
 * @param {object} opts.baseConfig - coded normalized config
 * @param {object} opts.overrides
 * @param {object} opts.effectiveConfig
 * @param {boolean} opts.scheduleLiveChangeSupported
 */
function buildConfigView({ baseConfig, overrides, effectiveConfig, scheduleLiveChangeSupported }) {
    const base = serializeBaseConfig(baseConfig)
    const effective = serializeBaseConfig(effectiveConfig)
    // Ensure enabled is reflected even though it is not always on baseConfig object
    base.enabled = baseConfig.enabled !== false
    effective.enabled = effectiveConfig.enabled !== false

    const fields = []
    const pushField = (path, coded, override, effectiveVal) => {
        const hasOverride = override !== undefined
        fields.push({
            path,
            overridable: isPathOverridable(path),
            source: hasOverride ? 'override' : 'coded',
            coded,
            override: hasOverride ? override : null,
            effective: effectiveVal,
        })
    }

    pushField('enabled', base.enabled, overrides.enabled, effective.enabled)
    pushField('mode', base.mode, overrides.mode, effective.mode)
    pushField('description', base.description ?? null, overrides.description, effective.description ?? null)
    pushField('schedule', base.schedule ?? null, overrides.schedule, effective.schedule ?? null)

    const codedRetention = base.retention || {}
    const overrideRetention = overrides.retention || {}
    const effRetention = effective.retention || {}
    for (const rk of OVERRIDABLE_RETENTION) {
        if (
            codedRetention[rk] !== undefined ||
            overrideRetention[rk] !== undefined ||
            effRetention[rk] !== undefined
        ) {
            pushField(
                `retention.${rk}`,
                codedRetention[rk] ?? null,
                overrideRetention[rk],
                effRetention[rk] ?? null,
            )
        }
    }

    const codedDelta = base.delta || {}
    const overrideDelta = overrides.delta || {}
    const effDelta = effective.delta || {}
    for (const dk of OVERRIDABLE_DELTA) {
        if (codedDelta[dk] !== undefined || overrideDelta[dk] !== undefined || effDelta[dk] !== undefined) {
            pushField(
                `delta.${dk}`,
                codedDelta[dk] ?? null,
                overrideDelta[dk],
                effDelta[dk] ?? null,
            )
        }
    }

    const codedSrc = base.source || {}
    const overrideSrc = overrides.source || {}
    const effSrc = effective.source || {}
    for (const sk of OVERRIDABLE_SOURCE) {
        pushField(
            `source.${sk}`,
            codedSrc[sk] ?? null,
            overrideSrc[sk],
            effSrc[sk] ?? null,
        )
    }

    pushField('flags', base.flags ?? null, overrides.flags, effective.flags ?? null)

    return {
        base,
        overrides: overrides || {},
        effective,
        fields,
        meta: {
            scheduleLiveChangeSupported: !!scheduleLiveChangeSupported,
            overridablePaths: [...OVERRIDABLE_PATHS],
        },
    }
}

function isPathOverridable(path) {
    return OVERRIDABLE_PATHS.includes(path)
}

/**
 * Whether a schedule/enabled hot-apply is needed after an overrides change.
 */
function needsScheduleRestart(patch, previousOverrides, previousEffective) {
    if (!patch) return false
    if ('schedule' in patch || 'enabled' in patch) return true
    // clearing schedule via clearOverrides
    return false
}

module.exports = {
    OVERRIDABLE_PATHS,
    OVERRIDABLE_TOP,
    OVERRIDABLE_SOURCE,
    OVERRIDABLE_DELTA,
    OVERRIDABLE_RETENTION,
    serializeBaseConfig,
    parseOverridesJson,
    deepMerge,
    validateOverridesPatch,
    clearOverrideKeys,
    applyOverrides,
    buildConfigView,
    isPathOverridable,
    needsScheduleRestart,
    safeClone,
}
