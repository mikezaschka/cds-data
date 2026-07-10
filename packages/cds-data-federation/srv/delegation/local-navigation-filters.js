const cds = require('@sap/cds')

const LOG = cds.log('cds-data-federation')

// ─── Local Navigation Filter Resolution (cross-service filter: remote → local) ─
//
// Mirror of resolveRemoteNavigationFilters for Scenario C. When a delegated
// entity's $filter uses a navigation path through a LOCAL association
// (e.g. Products?$filter=LocalEntity/Name eq 'Product 3'), the remote service
// does not know about that association. Pre-resolve against the local DB,
// collect matching source keys, and rewrite to `sourceKey in [values]` before
// forwarding to the remote.
//
// CQN thenable caution: same as resolveLocalLambdaFilters (see lambda-filters.js).

/**
 * Detects navigation path filters through local associations on a delegated
 * entity, queries the local DB for matching FKs, and rewrites to a simple
 * source-key IN filter.
 *
 * @param {object} query - CQN query
 * @param {Map} localAssocsByName - Map of assoc name → { name, target, fkColumn, sourceKey, is2many }
 * @param {object} service - CAP application service (for local DB queries)
 * @returns {object|Promise<{_cqn}>} original query or Promise wrapping modified query
 */
function resolveLocalNavigationFilters(query, localAssocsByName, service) {
    const where = query?.SELECT?.where
    if (!where || !localAssocsByName || localAssocsByName.size === 0) return query
    if (!containsLocalNavRef(where, localAssocsByName)) return query

    const cloned = cds.ql.clone(query)
    return rewriteLocalNavFilters(cloned.SELECT.where, localAssocsByName, service)
        .then(() => ({ _cqn: cloned }))
}

function containsLocalNavRef(nodes, localAssocsByName) {
    if (!Array.isArray(nodes)) return false
    for (const node of nodes) {
        if (node?.ref && node.ref.length >= 2) {
            const assocName = extractAssocName(node.ref[0])
            if (assocName && localAssocsByName.has(assocName)) return true
        }
        if (node?.func && Array.isArray(node.args)) {
            if (containsLocalNavRef(node.args, localAssocsByName)) return true
        }
        if (node?.xpr) {
            if (containsLocalNavRef(node.xpr, localAssocsByName)) return true
        }
    }
    return false
}

/**
 * Walks a CQN WHERE array and rewrites local-association navigation refs in-place.
 * Handles:
 *   1. Comparison triplet: { ref: [assoc, field] } op { val } → sourceKey in [keys]
 *   2. Function call: { func, args: [{ ref: [assoc, field] }, ...] } → sourceKey in [keys]
 */
async function rewriteLocalNavFilters(where, localAssocsByName, service) {
    if (!Array.isArray(where)) return

    for (let i = 0; i < where.length; i++) {
        const node = where[i]

        if (node?.xpr) {
            await rewriteLocalNavFilters(node.xpr, localAssocsByName, service)
            continue
        }

        // Pattern 1: comparison triplet — { ref: [assoc, field] } op val
        if (node?.ref && node.ref.length >= 2 && i + 2 < where.length) {
            const assocName = extractAssocName(node.ref[0])
            if (assocName && localAssocsByName.has(assocName) && typeof where[i + 1] === 'string') {
                const assoc = localAssocsByName.get(assocName)
                const localCondition = [stripAssocPrefix(node), where[i + 1], where[i + 2]]
                const replacement = await resolveLocalNavCondition(assoc, localCondition, service)
                where.splice(i, 3, ...replacement)
                continue
            }
        }

        // Pattern 2: function call with a nav ref argument
        if (node?.func && Array.isArray(node.args)) {
            const navArg = node.args.find(a => a?.ref && a.ref.length >= 2)
            if (navArg) {
                const assocName = extractAssocName(navArg.ref[0])
                if (assocName && localAssocsByName.has(assocName)) {
                    const assoc = localAssocsByName.get(assocName)
                    const translatedFunc = {
                        func: node.func,
                        args: node.args.map(a =>
                            a?.ref?.length >= 2 ? stripAssocPrefix(a) : a
                        )
                    }
                    const replacement = await resolveLocalNavCondition(assoc, [translatedFunc], service)
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

/** { ref: [assocName, field, ...] } → { ref: [field, ...] } for the local target query. */
function stripAssocPrefix(node) {
    return { ref: node.ref.slice(1) }
}

/**
 * Queries the local association target with the stripped condition, collects
 * FK values, and returns a sourceKey IN replacement for the delegate WHERE.
 */
async function resolveLocalNavCondition(assoc, localWhereNodes, service) {
    const targetShortName = assoc.target.split('.').pop()
    const q = SELECT.from(targetShortName).columns(assoc.fkColumn)
    q.SELECT.where = localWhereNodes

    let matchedKeys
    try {
        const results = await service.run(q)
        matchedKeys = [...new Set(results.map(r => r[assoc.fkColumn]).filter(v => v != null))]
    } catch (e) {
        LOG.warn(`Local navigation filter query failed for '${assoc.name}': ${e.message}`)
        return localWhereNodes
    }

    if (matchedKeys.length === 0) {
        return [{ val: 1 }, '=', { val: 0 }]
    }
    return [{ ref: [assoc.sourceKey] }, 'in', { list: matchedKeys.map(k => ({ val: k })) }]
}

module.exports = { resolveLocalNavigationFilters }
