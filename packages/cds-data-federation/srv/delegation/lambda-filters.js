const cds = require('@sap/cds')

// ─── Local Lambda Filter Resolution (cross-service filter: remote → local) ──────
//
// When a delegated entity has local associations (cross-service expand: remote → local),
// the client can filter using lambdas on those local collections, e.g.:
//   Customers?$filter=bookmarks/any(b:b/label eq '...')
//
// CAP parses this into an `exists` CQN expression referencing the local association.
// The remote doesn't know about the local association, so we pre-resolve the lambda
// by querying the local DB, collecting matching FK values, and replacing the `exists`
// with a simple `sourceKey in [values]` filter before forwarding to the remote.

/**
 * Walks a CQN WHERE clause, detects `exists` / `not exists` expressions that reference
 * local associations, pre-resolves them against the local DB, and returns a modified query.
 * Returns the original query unchanged if no local lambdas are found.
 *
 * IMPORTANT: CQN query objects are "thenables" (they have a .then getter that executes the
 * query). Returning a CQN from an async function causes Promise resolution to follow the
 * thenable, re-executing the query and triggering infinite recursion through the handler chain.
 * This function is therefore NOT async — it returns synchronously in the common case and
 * returns a real Promise (wrapping the result in a non-thenable object) in the rare async case.
 */
function resolveLocalLambdaFilters(query, localAssocsByName, service) {
    const where = query?.SELECT?.where
    if (!where || localAssocsByName.size === 0) return query
    if (!containsLocalLambda(where, localAssocsByName)) return query

    const cloned = cds.ql.clone(query)
    return rewriteLocalLambdas(cloned.SELECT.where, localAssocsByName, service)
        .then(() => { return { _cqn: cloned } })
}

/**
 * Returns true if a WHERE clause contains `exists` expressions referencing local associations.
 */
function containsLocalLambda(where, localAssocsByName) {
    if (!Array.isArray(where)) return false
    for (let i = 0; i < where.length; i++) {
        if (where[i] === 'exists' || (where[i] === 'not' && where[i + 1] === 'exists')) {
            const existsIdx = where[i] === 'exists' ? i : i + 1
            const refItem = where[existsIdx + 1]
            if (refItem?.ref) {
                const firstSeg = refItem.ref[0]
                const assocName = typeof firstSeg === 'string' ? firstSeg : firstSeg?.id
                if (assocName && localAssocsByName.has(assocName)) return true
            }
        }
        if (typeof where[i] === 'object' && where[i]?.xpr) {
            if (containsLocalLambda(where[i].xpr, localAssocsByName)) return true
        }
    }
    return false
}

/**
 * Rewrites `exists` / `not exists` expressions referencing local associations IN-PLACE.
 * Replaces `exists {ref:[{id:'bookmarks', where:[...]}]}` with `{ref:['ID']} in [values]`.
 * Replaces `not exists ...` with `{ref:['ID']} not in [values]` (using `not in` CQN).
 */
async function rewriteLocalLambdas(where, localAssocsByName, service) {
    if (!Array.isArray(where)) return

    for (let i = 0; i < where.length; i++) {
        const isNot = where[i] === 'not' && where[i + 1] === 'exists'
        const isExists = where[i] === 'exists'

        if (!isExists && !isNot) {
            if (typeof where[i] === 'object' && where[i]?.xpr) {
                await rewriteLocalLambdas(where[i].xpr, localAssocsByName, service)
            }
            continue
        }

        const existsIdx = isNot ? i + 1 : i
        const refItem = where[existsIdx + 1]
        if (!refItem?.ref) continue

        const firstSeg = refItem.ref[0]
        const assocName = typeof firstSeg === 'string' ? firstSeg : firstSeg?.id
        if (!assocName || !localAssocsByName.has(assocName)) continue

        const assoc = localAssocsByName.get(assocName)
        const innerWhere = typeof firstSeg === 'object' ? firstSeg.where : null

        const targetShortName = assoc.target.split('.').pop()
        const q = SELECT.from(targetShortName).columns(assoc.fkColumn)
        if (innerWhere) {
            q.where(innerWhere)
        }
        const localResults = await service.run(q)
        const matchedKeys = [...new Set(localResults.map(r => r[assoc.fkColumn]).filter(v => v != null))]

        let replacement
        if (matchedKeys.length === 0) {
            replacement = isNot
                ? [{ val: 1 }, '=', { val: 1 }]
                : [{ val: 1 }, '=', { val: 0 }]
        } else if (isNot) {
            replacement = [{ ref: [assoc.sourceKey] }, 'not in', { val: matchedKeys }]
        } else {
            replacement = [{ ref: [assoc.sourceKey] }, 'in', { val: matchedKeys }]
        }

        const removeCount = isNot ? 3 : 2
        where.splice(i, removeCount, ...replacement)
    }
}

module.exports = { resolveLocalLambdaFilters }
