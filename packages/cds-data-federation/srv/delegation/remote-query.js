// ─── Lambda (any/all) Query Support ─────────────────────────────────────────────
//
// CAP's cds.ql.resolve() corrupts `exists` CQN expressions when translating through
// projection chains — it strips the inner `where` clause from the ref, turning
// {id:"orders", where:[...]} into just "orders". This causes cqn2odata to generate
// `exists orders` instead of the proper `orders/any(...)` OData lambda syntax.
//
// Workaround: detect lambda (exists) expressions, build a CQN that directly targets
// the remote entity (bypassing cds.ql.resolve), translate field names manually,
// and map results back.

const { runPagedRemoteQuery } = require('./paged-remote-query')

/**
 * Returns true if a CQN WHERE array contains `exists` or `not exists` expressions.
 */
function containsLambda(where) {
    if (!Array.isArray(where)) return false
    return where.some((item, i) => {
        if (item === 'exists') return true
        if (item === 'not' && where[i + 1] === 'exists') return true
        if (typeof item === 'object' && item.xpr) return containsLambda(item.xpr)
        return false
    })
}

/**
 * Translates field refs inside a CQN WHERE clause using localToRemote mapping.
 * Handles nested xpr, func args, and lambda (exists) refs.
 */
function translateWhere(where, localToRemote) {
    if (!Array.isArray(where) || !localToRemote) return where
    const result = []
    for (const item of where) {
        if (typeof item === 'object' && item !== null) {
            if (item.ref) {
                const translated = item.ref.map(seg => {
                    if (typeof seg === 'string') return localToRemote[seg] || seg
                    if (seg.id) {
                        const newSeg = { ...seg, id: localToRemote[seg.id] || seg.id }
                        if (seg.where) newSeg.where = translateWhere(seg.where, localToRemote)
                        return newSeg
                    }
                    return seg
                })
                result.push({ ...item, ref: translated })
            } else if (item.xpr) {
                result.push({ ...item, xpr: translateWhere(item.xpr, localToRemote) })
            } else if (item.func && item.args) {
                result.push({ ...item, args: translateWhere(item.args, localToRemote) })
            } else {
                result.push(item)
            }
        } else {
            result.push(item)
        }
    }
    return result
}

/**
 * Builds and runs a CQN that targets the remote entity directly, bypassing
 * CAP's cds.ql.resolve() projection chain traversal. This is required when:
 *   - The query contains lambda (exists) expressions (CAP corrupts inner WHERE)
 *   - The entity has local-only associations (cross-service expand: remote → local backlinks) that cause
 *     CAP's projection resolution to enter an infinite loop on circular refs
 *
 * Translates field names manually using the viewMapping dictionaries.
 */
async function runDirectRemoteQuery(remote, sourceServiceName, originalQuery, viewMapping) {
    const sel = originalQuery.SELECT
    const { localToRemote, remoteToLocal, projectedColumns, staticWhere, sourceEntity, isWildcard } = viewMapping || {}

    const entityName = sourceEntity || sel.from?.ref?.[0]?.id || sel.from?.ref?.[0] || sel.from
    const remoteEntity = `${sourceServiceName}.${entityName}`

    const remoteWhere = localToRemote
        ? translateWhere(sel.where, localToRemote)
        : sel.where

    const q = SELECT.from(remoteEntity)
    if (remoteWhere) q.SELECT.where = remoteWhere

    if (staticWhere) {
        const clonedWhere = JSON.parse(JSON.stringify(staticWhere))
        if (q.SELECT.where) {
            q.SELECT.where.push('and', ...clonedWhere)
        } else {
            q.SELECT.where = clonedWhere
        }
    }

    if (sel.columns) {
        const hasWildcard = sel.columns.some(c => c === '*' || c['*'])
        if (hasWildcard && !isWildcard && projectedColumns?.length) {
            const remoteCols = projectedColumns.map(c => ({ ref: [c] }))
            const expandCols = sel.columns.filter(c => c.expand)
            for (const col of expandCols) {
                const translatedRef = localToRemote
                    ? col.ref.map(seg => (typeof seg === 'string' ? localToRemote[seg] || seg : seg))
                    : col.ref
                remoteCols.push({ ...col, ref: translatedRef })
            }
            q.SELECT.columns = remoteCols
        } else {
            const remoteCols = []
            for (const col of sel.columns) {
                if (col.expand) {
                    const translatedRef = localToRemote
                        ? col.ref.map(seg => (typeof seg === 'string' ? localToRemote[seg] || seg : seg))
                        : col.ref
                    remoteCols.push({ ...col, ref: translatedRef })
                } else if (col.ref) {
                    const translatedRef = col.ref.map(seg =>
                        typeof seg === 'string' ? (localToRemote?.[seg] || seg) : seg
                    )
                    remoteCols.push({ ...col, ref: translatedRef })
                } else if (col === '*' || col['*']) {
                    remoteCols.push(col)
                } else {
                    remoteCols.push(col)
                }
            }
            if (remoteCols.length > 0) q.SELECT.columns = remoteCols
        }
    } else if (projectedColumns?.length) {
        const remoteCols = projectedColumns.map(c => localToRemote?.[c] || c)
        q.SELECT.columns = remoteCols.map(c => ({ ref: [c] }))
    }

    if (sel.limit) q.SELECT.limit = sel.limit
    if (sel.orderBy) {
        q.SELECT.orderBy = localToRemote
            ? sel.orderBy.map(o => {
                if (o.ref) {
                    const mapped = o.ref.map(r => (typeof r === 'string' ? localToRemote[r] || r : r))
                    return { ...o, ref: mapped }
                }
                return o
            })
            : sel.orderBy
    }
    if (sel.count) q.SELECT.count = sel.count

    const results = await runPagedRemoteQuery(remote, q)

    if (!remoteToLocal || Object.keys(remoteToLocal).length === 0) return results

    if (!Array.isArray(results)) return results
    const mapped = results.map(row => mapRow(row, remoteToLocal))
    if ('$count' in results) mapped.$count = results.$count
    return mapped
}

function mapRow(row, remoteToLocal) {
    const mapped = {}
    for (const [key, val] of Object.entries(row)) {
        mapped[remoteToLocal[key] || key] = val
    }
    return mapped
}

/**
 * Extracts the original HTTP status code from a CAP remote service error.
 * CAP wraps all remote errors as 502 (Bad Gateway), burying the original status
 * in err.reason.response.status. This function re-throws with the original status
 * so that e.g. a remote 404 surfaces as a 404 to the consumer, not a 502.
 */
// eslint-disable-next-line no-unused-vars
function propagateRemoteError(err, _sourceServiceName) {
    const remoteStatus = err?.reason?.response?.status
    const remoteMessage = err?.reason?.response?.body?.error?.message
        ?? err?.reason?.response?.body?.error?.message?.value
        ?? err?.message
    if (remoteStatus && remoteStatus !== 502) {
        const propagated = new Error(remoteMessage)
        propagated.statusCode = remoteStatus
        propagated.message = remoteMessage
        return propagated
    }
    return err
}

module.exports = { containsLambda, runDirectRemoteQuery, propagateRemoteError }
