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

const cds = require('@sap/cds')
const { runPagedRemoteQuery } = require('./paged-remote-query')
const { projectedColumnToSelectArg } = require('cds-data-pipeline/srv/lib/columnRefPath')
const {
    buildInnerColumns,
    isAssociationColumn,
    projectedScalarColumns,
} = require('./expand-columns')

const LOG = cds.log('cds-data-federation')

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
 *
 * Products?$filter=unitPrice gt 100
 *   Input  CQN.where: [ { ref: ['unitPrice'] }, '>', { val: 100 } ]
 *   Output CQN.where: [ { ref: ['price'] },      '>', { val: 100 } ]
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

function translateRef(ref, localToRemote) {
    return ref.map(seg =>
        typeof seg === 'string' ? (localToRemote?.[seg] || seg) : seg
    )
}

function normalizeExpandColumn(
    col,
    viewMapping,
    remoteEntityDef,
    entityFullName,
    viewMappingRegistry,
) {
    const localToRemote = viewMapping?.localToRemote || {}
    const translatedRef = translateRef(col.ref, localToRemote)
    const localAssocName = col.ref?.[0]
    const remoteAssocName = translatedRef?.[0]
    const localEntityDef = cds.model?.definitions?.[entityFullName]
    const localTargetName = localEntityDef?.elements?.[localAssocName]?.target
    const targetMapping = viewMappingRegistry?.[localTargetName] || {}
    const remoteTargetName = remoteEntityDef?.elements?.[remoteAssocName]?.target
    const remoteTargetDef = cds.model?.definitions?.[remoteTargetName]

    const innerColumns = buildInnerColumns(
        col,
        targetMapping.localToRemote || {},
        targetMapping,
        null,
        remoteTargetDef,
        {
            mapExpand: nested => normalizeExpandColumn(
                nested,
                targetMapping,
                remoteTargetDef,
                localTargetName,
                viewMappingRegistry,
            ),
        },
    )

    return { ...col, ref: translatedRef, expand: innerColumns }
}

function buildDirectRemoteColumns(
    sel,
    viewMapping,
    remoteEntityDef,
    entityFullName,
    viewMappingRegistry,
) {
    const { localToRemote, projectedColumns, isWildcard } = viewMapping || {}

    if (!sel.columns) {
        if (isWildcard || !projectedColumns?.length) return null
        return projectedColumns
            .filter(col => !isAssociationColumn(col, remoteEntityDef))
            .map(col => projectedColumnToSelectArg(col))
    }

    const hasWildcard = sel.columns.some(col => col === '*' || col?.['*'])
    if (hasWildcard) {
        const remoteCols = projectedScalarColumns(viewMapping, remoteEntityDef)
            .map(col => projectedColumnToSelectArg(col))
        for (const col of sel.columns.filter(item => item?.expand)) {
            remoteCols.push(normalizeExpandColumn(
                col,
                viewMapping,
                remoteEntityDef,
                entityFullName,
                viewMappingRegistry,
            ))
        }
        return remoteCols
    }

    const remoteCols = []
    for (const col of sel.columns) {
        if (col?.expand) {
            remoteCols.push(normalizeExpandColumn(
                col,
                viewMapping,
                remoteEntityDef,
                entityFullName,
                viewMappingRegistry,
            ))
        } else if (col?.ref) {
            remoteCols.push({ ...col, ref: translateRef(col.ref, localToRemote) })
        } else {
            remoteCols.push(col)
        }
    }
    return remoteCols
}

/**
 * Builds and runs a CQN that targets the remote entity directly, bypassing
 * CAP's cds.ql.resolve() projection chain traversal. This is required when:
 *   - The query contains lambda (exists) expressions (CAP corrupts inner WHERE)
 *   - The entity has local-only associations (cross-service expand: remote → local backlinks) that cause
 *     CAP's projection resolution to enter an infinite loop on circular refs
 *
 * Translates field names manually using the viewMapping dictionaries.
 *
 * Products?$filter=unitPrice gt 100&$select=productName
 *   Input  from: ConsumerService.Products, where: unitPrice, columns: productName
 *   Output from: ProviderService.Products, where: price,      columns: name
 *   (bypasses projection chain; results mapped back via remoteToLocal)
 */
async function runDirectRemoteQuery(
    remote,
    sourceServiceName,
    originalQuery,
    viewMapping,
    { entityFullName, viewMappingRegistry } = {},
) {
    const sel = originalQuery.SELECT
    const { localToRemote, remoteToLocal, staticWhere, sourceEntity } = viewMapping || {}

    const entityName = sourceEntity || sel.from?.ref?.[0]?.id || sel.from?.ref?.[0] || sel.from
    const remoteEntity = `${sourceServiceName}.${entityName}`
    const remoteEntityDef = cds.model?.definitions?.[remoteEntity]

    const reasons = []
    if (staticWhere) reasons.push('staticWhere')
    if (containsLambda(sel.where)) reasons.push('lambda')
    LOG.debug(`Bypassing CAP projection chain for ${remoteEntity}${reasons.length ? ` (reason: ${reasons.join(', ')})` : ''}`)

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

    const remoteColumns = buildDirectRemoteColumns(
        sel,
        viewMapping,
        remoteEntityDef,
        entityFullName,
        viewMappingRegistry,
    )
    if (remoteColumns?.length) q.SELECT.columns = remoteColumns

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

    if (!Array.isArray(results)) return results
    const hasTopLevelMapping = remoteToLocal && Object.keys(remoteToLocal).length > 0
    if (!hasTopLevelMapping && (!entityFullName || !viewMappingRegistry)) return results
    const mapped = results.map(row => mapRow(
        row,
        remoteToLocal || {},
        remoteEntityDef,
        entityFullName,
        viewMappingRegistry,
    ))
    if ('$count' in results) mapped.$count = results.$count
    return mapped
}

function mapRow(row, remoteToLocal, remoteEntityDef, entityFullName, viewMappingRegistry) {
    const mapped = {}
    for (const [key, val] of Object.entries(row)) {
        const localKey = remoteToLocal[key] || key
        const remoteElement = remoteEntityDef?.elements?.[key]
        if (remoteElement?.target && val != null && typeof val === 'object') {
            const localEntityDef = cds.model?.definitions?.[entityFullName]
            const localTargetName = localEntityDef?.elements?.[localKey]?.target
            const targetMapping = viewMappingRegistry?.[localTargetName] || {}
            const remoteTargetDef = cds.model?.definitions?.[remoteElement.target]
            if (Array.isArray(val)) {
                mapped[localKey] = val.map(item => mapRow(
                    item,
                    targetMapping.remoteToLocal || {},
                    remoteTargetDef,
                    localTargetName,
                    viewMappingRegistry,
                ))
            } else {
                mapped[localKey] = mapRow(
                    val,
                    targetMapping.remoteToLocal || {},
                    remoteTargetDef,
                    localTargetName,
                    viewMappingRegistry,
                )
            }
        } else {
            mapped[localKey] = val
        }
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

module.exports = {
    buildDirectRemoteColumns,
    containsLambda,
    runDirectRemoteQuery,
    propagateRemoteError,
}
