const cds = require('@sap/cds')
const LOG = cds.log('cds-data-federation')

const ENTITY_CACHE_NS = 'plugin.data_federation.entity_cache'

function isDelegatedEntityStrategy(config) {
    return config.strategy === 'delegate'
}

function usesEntityCacheAnnotation(config) {
    const cache = config.options.cache
    const strategy = cache?.strategy ?? 'response'
    return !!(cache && strategy === 'entity')
}

function sanitizedTableStem(entityFullName) {
    return `EC_${entityFullName.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_|_$/g, '')}`
}

function storageFqnForStem(stem) {
    return `${ENTITY_CACHE_NS}.${stem}`
}

function isPersistable(el) {
    return el && typeof el === 'object' && !el.target
}

/** Copy persisted scalar CDS elements (omit associations/compositions). */
function copyPersistableElements(srcElements, viewMapping, isWildcard, excludedCols) {
    const elements = {}

    if (!srcElements || typeof srcElements !== 'object') return elements

    const excluded = new Set(excludedCols || [])

    if (isWildcard) {
        for (const [rn, el] of Object.entries(srcElements)) {
            if (excluded.has(rn)) continue
            if (!isPersistable(el)) continue
            const ln = viewMapping.remoteToLocal?.[rn] || rn
            elements[ln] = sanitizeElementDefn(el)
        }
        return elements
    }

    for (const rn of viewMapping.projectedColumns || []) {
        if (!rn) continue
        const srcEl = srcElements[rn]
        if (!srcEl || !isPersistable(srcEl)) continue
        const ln = viewMapping.remoteToLocal?.[rn] || rn
        elements[ln] = sanitizeElementDefn(srcEl)
    }

    return elements
}

function sanitizeElementDefn(el) {
    const neo = {
        key: !!el.key,
    }
    neo.type = el.type || 'cds.String'
    if (el.length !== undefined && el.length !== null) neo.length = el.length
    if (el.precision !== undefined) neo.precision = el.precision
    if (el.scale !== undefined) neo.scale = el.scale
    return neo
}

function ensureNamespaceAncestors(defs) {
    if (!defs['plugin']) {
        defs.plugin = { kind: 'namespace' }
    }
    if (!defs['plugin.data_federation']) {
        defs['plugin.data_federation'] = { kind: 'namespace' }
    }
    if (!defs[ENTITY_CACHE_NS]) {
        defs[ENTITY_CACHE_NS] = { kind: 'namespace' }
    }
}

function applyEntityStorageModel(defs, cfg) {
    const srcFq = `${cfg.sourceService}.${cfg.sourceEntity}`
    const srcDef = defs[srcFq]
    if (!srcDef || srcDef.kind !== 'entity') {
        LOG.warn(
            `Skipping entity-cache for '${cfg.entityFullName}' — missing source '${srcFq}' ` +
                '(REST without CDS model entity is unsupported for entity caching in MVP).',
        )
        cfg.entityCacheSkipped = true
        return
    }

    const vm = cfg.viewMapping || {}
    const elements = copyPersistableElements(srcDef.elements, vm, !!vm.isWildcard, vm.excludedColumns)

    if (Object.keys(elements).length === 0) {
        LOG.warn(`Skipping entity-cache for '${cfg.entityFullName}' — no scalar columns inferred`)
        cfg.entityCacheSkipped = true
        return
    }

    const stem = sanitizedTableStem(cfg.entityFullName)
    const fq = storageFqnForStem(stem)

    defs[fq] = {
        kind: 'entity',
        '@cds.persistence.table': true,
        elements,
    }

    cfg.entityCache = {
        storageFqn: fq,
    }
}

/**
 * Mutates compiled CSN: adds `plugin.data_federation.entity_cache.EC_<entity>` tables,
 * attaches `cfg.entityCache` metadata for pipelines + handlers.
 */
function injectEntityCacheDefinitions(csn, configs) {
    const defs = csn.definitions || (csn.definitions = {})

    const entityCacheConfigs = configs.filter(isDelegatedEntityStrategy).filter(usesEntityCacheAnnotation)
    if (!entityCacheConfigs.length) return

    ensureNamespaceAncestors(defs)

    for (const c of entityCacheConfigs) {
        applyEntityStorageModel(defs, c)
    }

    LOG.debug(`Injected ${entityCacheConfigs.length} entity-cache storage definition(s)`)
}

function pipelineDisplayName(cfg) {
    return `federation-entity-cache:${cfg.entityFullName}`
}

module.exports = {
    ENTITY_CACHE_NS,
    sanitizedTableStem,
    storageFqnForStem,
    usesEntityCacheAnnotation,
    injectEntityCacheDefinitions,
    pipelineDisplayName,
}
