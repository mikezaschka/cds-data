/**
 * Federation entity-cache pipelines register a per-tenant DB resolver here.
 * Keeps cds-data-pipeline free of a federation dependency (ADR 0010).
 */

/** @type {Map<string, () => Promise<object>>} */
const _resolvers = new Map()

function registerEntityCacheTargetDb(pipelineName, resolverFn) {
    if (!pipelineName || typeof resolverFn !== 'function') return
    _resolvers.set(pipelineName, resolverFn)
}

async function resolveEntityCacheTargetDb(pipelineName) {
    const fn = _resolvers.get(pipelineName)
    if (!fn) {
        throw new Error(
            `No entity-cache DB resolver registered for pipeline '${pipelineName}'. ` +
                'Ensure cds-data-federation bound the entity-cache pipeline before execution.',
        )
    }
    return fn()
}

function clearEntityCacheTargetRegistry() {
    _resolvers.clear()
}

module.exports = {
    registerEntityCacheTargetDb,
    resolveEntityCacheTargetDb,
    clearEntityCacheTargetRegistry,
}
