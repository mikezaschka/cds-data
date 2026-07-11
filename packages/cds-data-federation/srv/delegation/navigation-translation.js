const cds = require('@sap/cds')

const LOG = cds.log('cds-data-federation')

// ─── Navigation Path Translation ────────────────────────────────────────────────
//
// CAP's automatic query translation handles scalar field renames ($filter=unitPrice gt 100
// → $filter=price gt 100) but does NOT translate association names used as navigation
// path prefixes ($filter=buyer/name → should become $filter=customer/name).
//
// This module walks the CQN WHERE clause and translates navigation path segments
// using the entity's localToRemote mapping and the viewMappingRegistry for target entities.

/**
 * Builds a map from local association names to their target entity's viewMapping.
 * Used for translating deeper segments in navigation paths (e.g., item/productName → product/name).
 */
function buildAssocTargetMappings(entityFullName, viewMappingRegistry) {
    const entityDef = cds.model?.definitions?.[entityFullName]
    if (!entityDef?.elements) return {}

    const assocTargets = {}
    for (const [elemName, elem] of Object.entries(entityDef.elements)) {
        if (!elem.target) continue
        const targetMapping = viewMappingRegistry[elem.target]
        if (targetMapping?.localToRemote && Object.keys(targetMapping.localToRemote).length > 0) {
            assocTargets[elemName] = targetMapping.localToRemote
        }
    }
    return assocTargets
}

/**
 * Translates navigation paths in a CQN WHERE clause from local to remote names.
 * Returns the original query if no translation is needed, or a cloned+modified query.
 *
 * Orders?$filter=buyer/name eq 'Acme'
 *   Input  CQN.where: [ { ref: ['buyer','name'] }, '=', { val: 'Acme' } ]
 *   Output CQN.where: [ { ref: ['customer','name'] }, '=', { val: 'Acme' } ]
 * (assoc `buyer` → `customer` via localToRemote; deeper segments via assocTargets)
 */
function translateNavigationFilters(query, viewMapping, assocTargets) {
    const where = query?.SELECT?.where
    if (!where || !viewMapping?.localToRemote) return query

    const { localToRemote } = viewMapping
    if (Object.keys(localToRemote).length === 0) return query

    let needsTranslation = false
    checkForNavigationRefs(where, localToRemote, () => { needsTranslation = true })
    if (!needsTranslation) return query

    const cloned = cds.ql.clone(query)
    LOG.debug('Translating navigation-path filters in WHERE clause (local → remote assoc/field names)')
    translateWhereClause(cloned.SELECT.where, localToRemote, assocTargets)
    return cloned
}

/**
 * Quick scan to detect if any navigation refs need translation (avoids unnecessary clone).
 */
function checkForNavigationRefs(nodes, localToRemote, onFound) {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
        if (onFound._found) return
        if (node?.ref && node.ref.length >= 2 && localToRemote[node.ref[0]]) {
            onFound._found = true
            onFound()
            return
        }
        if (node?.func && Array.isArray(node.args)) {
            checkForNavigationRefs(node.args, localToRemote, onFound)
        }
        if (node?.xpr) {
            checkForNavigationRefs(node.xpr, localToRemote, onFound)
        }
    }
}

/**
 * Recursively walks a CQN WHERE array and translates navigation path refs in-place.
 */
function translateWhereClause(nodes, localToRemote, assocTargets) {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
        translateNode(node, localToRemote, assocTargets)
    }
}

function translateNode(node, localToRemote, assocTargets) {
    if (!node || typeof node !== 'object') return

    if (node.ref && node.ref.length >= 2) {
        const localAssocName = node.ref[0]
        const remoteAssocName = localToRemote[localAssocName]
        if (remoteAssocName) {
            const originalPath = node.ref.join('/')
            node.ref[0] = remoteAssocName
            const targetLocalToRemote = assocTargets?.[localAssocName]
            if (targetLocalToRemote) {
                for (let i = 1; i < node.ref.length; i++) {
                    if (typeof node.ref[i] === 'string' && targetLocalToRemote[node.ref[i]]) {
                        node.ref[i] = targetLocalToRemote[node.ref[i]]
                    }
                }
            }
            LOG.debug(`Renamed navigation path: ${originalPath} → ${node.ref.join('/')}`)
        }
    }

    if (node.func && Array.isArray(node.args)) {
        for (const arg of node.args) {
            translateNode(arg, localToRemote, assocTargets)
        }
    }

    if (node.xpr) {
        translateWhereClause(node.xpr, localToRemote, assocTargets)
    }
}

module.exports = { buildAssocTargetMappings, translateNavigationFilters }
