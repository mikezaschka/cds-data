const cds = require('@sap/cds')

const LOG = cds.log('cds-data-federation')

// ─── Remote Navigation Filter Resolution (cross-service filter: local → remote) ─
//
// When a local entity's $filter uses a navigation path through an association to
// a federated entity (e.g., Reviews?$filter=product/productName eq 'Laptop Pro'),
// CAP cannot resolve this via SQL because the target entity has no local table.
//
// This module pre-resolves the navigation filter by querying the remote service,
// collecting matching keys, and rewriting the filter to a simple FK IN condition
// on the local table. Each navigation condition is resolved independently so that
// boolean operators (and/or) between conditions remain correct.
//
// CQN thenable caution: same as resolveLocalLambdaFilters (see lambda-filters.js).
// Returns synchronously when no remote nav refs found; returns Promise<{_cqn}>
// when async rewrite is needed.

/**
 * Detects cross-service navigation path filters in a local entity's WHERE clause,
 * queries the remote service for matching keys, and rewrites the navigation filters
 * to simple FK IN filters on the local table.
 *
 * Reviews?$filter=product/productName eq 'Laptop Pro'
 *   Input  CQN.where: [ { ref: ['product','productName'] }, '=', { val: 'Laptop Pro' } ]
 *   Output CQN.where: [ { ref: ['product_ID'] }, 'in', { list: [{ val: 'P001' }, ...] } ]
 *
 * @param {object} query - CQN query
 * @param {Map} fedAssocByName - Map of assoc name → { name, target, keys, federation }
 * @returns {object|Promise<{_cqn}>} original query or Promise wrapping modified query
 */
function resolveRemoteNavigationFilters(query, fedAssocByName) {
    const where = query?.SELECT?.where
    if (!where || fedAssocByName.size === 0) return query
    if (!containsRemoteNavRef(where, fedAssocByName)) return query

    LOG.debug('Detected cross-service navigation filter (local → remote); pre-resolving via remote query')
    const cloned = cds.ql.clone(query)
    return rewriteRemoteNavFilters(cloned.SELECT.where, fedAssocByName)
        .then(() => ({ _cqn: cloned }))
}

function containsRemoteNavRef(nodes, fedAssocByName) {
    if (!Array.isArray(nodes)) return false
    for (const node of nodes) {
        if (node?.ref && node.ref.length >= 2) {
            const seg = node.ref[0]
            const assocName = typeof seg === 'string' ? seg : seg?.id
            if (assocName && fedAssocByName.has(assocName)) return true
        }
        if (node?.func && Array.isArray(node.args)) {
            if (containsRemoteNavRef(node.args, fedAssocByName)) return true
        }
        if (node?.xpr) {
            if (containsRemoteNavRef(node.xpr, fedAssocByName)) return true
        }
    }
    return false
}

/**
 * Walks a CQN WHERE array and rewrites navigation refs to federated entities in-place.
 * Handles two patterns:
 *   1. Comparison triplet: { ref: [assoc, field] } op { val } → FK in [keys]
 *   2. Function call: { func, args: [{ ref: [assoc, field] }, ...] } → FK in [keys]
 */
async function rewriteRemoteNavFilters(where, fedAssocByName) {
    if (!Array.isArray(where)) return

    for (let i = 0; i < where.length; i++) {
        const node = where[i]

        if (node?.xpr) {
            await rewriteRemoteNavFilters(node.xpr, fedAssocByName)
            continue
        }

        // Pattern 1: comparison triplet — { ref: [assoc, field] } op val
        if (node?.ref && node.ref.length >= 2 && i + 2 < where.length) {
            const assocName = extractAssocName(node.ref[0])
            if (assocName && fedAssocByName.has(assocName) && typeof where[i + 1] === 'string') {
                const assoc = fedAssocByName.get(assocName)
                const remoteCondition = [translateNavRef(node, assoc), where[i + 1], where[i + 2]]
                const replacement = await resolveNavCondition(assoc, remoteCondition)
                where.splice(i, 3, ...replacement)
                continue
            }
        }

        // Pattern 2: function call with a nav ref argument
        if (node?.func && Array.isArray(node.args)) {
            const navArg = node.args.find(a => a?.ref && a.ref.length >= 2)
            if (navArg) {
                const assocName = extractAssocName(navArg.ref[0])
                if (assocName && fedAssocByName.has(assocName)) {
                    const assoc = fedAssocByName.get(assocName)
                    const translatedFunc = {
                        func: node.func,
                        args: node.args.map(a =>
                            a?.ref?.length >= 2 ? translateNavRef(a, assoc) : a
                        )
                    }
                    const replacement = await resolveNavCondition(assoc, [translatedFunc])
                    where.splice(i, 1, ...replacement)
                    continue
                }
            }
        }
    }
}

function extractAssocName(segment) {
    return typeof segment === 'string' ? segment : segment?.id
}

/**
 * Translates a navigation ref { ref: [assocName, localField] } to { ref: [remoteField] }.
 */
function translateNavRef(node, assoc) {
    const { localToRemote = {} } = assoc.federation.viewMapping || {}
    const localFieldName = node.ref[node.ref.length - 1]
    const remoteFieldName = localToRemote[localFieldName] || localFieldName
    return { ref: [remoteFieldName] }
}

/**
 * Queries the remote service with a single translated condition, collects matching
 * keys, and returns the FK IN replacement for the local WHERE clause.
 *
 * Remote query: SELECT ID FROM Products WHERE name eq 'Laptop Pro'
 *   Output CQN.where: [ { ref: ['product_ID'] }, 'in', { list: [{ val: 'P001' }, ...] } ]
 */
async function resolveNavCondition(assoc, remoteWhereNodes) {
    const { sourceService, sourceEntity, viewMapping } = assoc.federation
    const { localToRemote = {} } = viewMapping || {}

    const keyDef = buildKeyDef(assoc, localToRemote)
    if (!keyDef) return remoteWhereNodes

    const remote = await cds.connect.to(sourceService)
    const remoteEntity = remote.entities[sourceEntity]
    if (!remoteEntity) {
        LOG.warn(`Entity '${sourceEntity}' not found in '${sourceService}'; skipping nav filter`)
        return remoteWhereNodes
    }

    const q = SELECT.from(remoteEntity).columns(keyDef.remote)
    q.SELECT.where = remoteWhereNodes

    LOG.debug(`Resolving remote nav filter on '${assoc.name}' via ${sourceService}.${sourceEntity}`)
    let matchedKeys
    try {
        const results = await remote.run(q)
        matchedKeys = [...new Set(results.map(r => r[keyDef.remote]).filter(v => v != null))]
    } catch (e) {
        LOG.warn(`Remote navigation filter query failed for '${assoc.name}': ${e.message}`)
        return remoteWhereNodes
    }

    if (matchedKeys.length === 0) {
        LOG.debug(`Remote nav filter on '${assoc.name}': no matching keys; rewriting to always-false`)
        return [{ val: 1 }, '=', { val: 0 }]
    }
    LOG.debug(`Remote nav filter on '${assoc.name}': ${matchedKeys.length} key(s) → ${keyDef.fk} in [...]`)
    return [{ ref: [keyDef.fk] }, 'in', { list: matchedKeys.map(k => ({ val: k })) }]
}

function buildKeyDef(assoc, localToRemote) {
    const keyDefs = (assoc.keys || []).map(k => {
        const keyName = Array.isArray(k.ref) ? k.ref[0] : k
        return {
            local: keyName,
            remote: localToRemote[keyName] || keyName,
            fk: `${assoc.name}_${keyName}`
        }
    })
    if (keyDefs.length !== 1) {
        LOG.warn(`Composite keys not supported for remote nav filters on '${assoc.name}'`)
        return null
    }
    return keyDefs[0]
}

module.exports = { resolveRemoteNavigationFilters }
