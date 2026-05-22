const cds = require('@sap/cds')

/**
 * Rewrite a consumption-view READ CQN to query the federation entity-cache storage entity.
 *
 * CDS `SELECT.from` prefers a single dotted name in `ref`, matching OData dispatch
 * (`{ ref: ['consumer.CachedCustomers'] }`).
 */
function fqRefParts(fqn) {
    return [fqn]
}

function rewriteQueryForEntityCacheStorage(query, storageFqn) {
    const q = cds.ql.clone(query)
    const sel = q.SELECT
    if (!sel || !storageFqn) return q

    sel.from = { ref: fqRefParts(storageFqn) }
    return q
}

/** @deprecated use rewriteQueryForEntityCacheStorage — tenant isolation is per SQLite file (ADR 0010) */
function rewriteConsumptionQueryForEntityCache(query, storageFqn, _tenantField, _tenantId) {
    return rewriteQueryForEntityCacheStorage(query, storageFqn)
}

module.exports = {
    fqRefParts,
    rewriteQueryForEntityCacheStorage,
    rewriteConsumptionQueryForEntityCache,
}
