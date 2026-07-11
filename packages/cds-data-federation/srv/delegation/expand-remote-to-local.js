const cds = require('@sap/cds')

const LOG = cds.log('cds-data-federation')

// ─── Cross-service expand: remote → local ───────────────────────────────────────
//
// Mirror of cross-service expand: local → remote. When a federated entity has
// associations to LOCAL entities (e.g., Customers extended with a backlink to
// Bookmarks), the plugin:
//   1. Strips local expand items from the query before forwarding to remote
//   2. Fetches the main entity from the remote service (delegated expands pass through)
//   3. Queries the local DB for the expanded local data
//   4. Stitches the local data into the remote results

/**
 * For a federated entity, finds associations that point to LOCAL (non-federated)
 * entities within the same service. These are candidates for
 * cross-service expand: remote → local.
 */
function buildLocalAssocInfo(servedEntityFullName, serviceName, federatedMap) {
    const entityDef = cds.model?.definitions?.[servedEntityFullName]
    if (!entityDef?.elements) return []

    const localAssocs = []
    for (const [elemName, elem] of Object.entries(entityDef.elements)) {
        if (!elem.target) continue
        if (federatedMap.has(elem.target)) continue
        if (!elem.target.startsWith(serviceName + '.')) continue
        if (elem.virtual) continue

        const targetDef = cds.model?.definitions?.[elem.target]
        if (!targetDef?.elements) continue

        const fkInfo = extractForeignKeyInfo(elem, elemName, servedEntityFullName, targetDef)
        if (!fkInfo) {
            LOG.debug(`Cannot determine FK mapping for local assoc '${elemName}' on '${servedEntityFullName}', skipping cross-service expand: remote → local`)
            continue
        }

        localAssocs.push({
            name: elemName,
            target: elem.target,
            fkColumn: fkInfo.fkColumn,
            sourceKey: fkInfo.sourceKey,
            is2many: !!elem.is2many
        })
        LOG.debug(`Found cross-service (remote → local) local assoc: ${servedEntityFullName}.${elemName} → ${elem.target}`)
    }

    return localAssocs
}

/**
 * Extracts FK column and source key from an association definition.
 * Prefers reverse managed association lookup (reliable for backlink patterns),
 * falls back to ON condition parsing for non-standard cases.
 */
function extractForeignKeyInfo(assocElem, assocName, sourceEntityFullName, targetDef) {
    for (const [elemName, elem] of Object.entries(targetDef.elements)) {
        if (elem.target !== sourceEntityFullName) continue
        if (!elem.keys?.length) continue

        const keyRef = elem.keys[0].ref
        const keyName = Array.isArray(keyRef) ? keyRef[0] : keyRef
        return { fkColumn: `${elemName}_${keyName}`, sourceKey: keyName }
    }

    if (assocElem.on) {
        const parsed = parseOnCondition(assocElem.on, assocName)
        if (parsed && parsed.sourceKey !== '$self') return parsed
    }

    return null
}

function parseOnCondition(on, assocName) {
    if (!Array.isArray(on)) return null
    for (let i = 0; i < on.length; i++) {
        if (on[i] !== '=') continue
        const left = on[i - 1]
        const right = on[i + 1]
        if (!left?.ref || !right?.ref) continue
        if (left.ref.length >= 2 && left.ref[0] === assocName && right.ref.length === 1) {
            return { fkColumn: left.ref[left.ref.length - 1], sourceKey: right.ref[0] }
        }
        if (right.ref.length >= 2 && right.ref[0] === assocName && left.ref.length === 1) {
            return { fkColumn: right.ref[right.ref.length - 1], sourceKey: left.ref[0] }
        }
    }
    return null
}

/**
 * Splits expand items in a query into local (cross-service: remote → local) and
 * remote (delegated expand). Returns the local expand items and a query with only
 * remote expands.
 *
 * Customers?$expand=bookmarks($select=label)
 *   Input  CQN.columns: [*, { ref: ['bookmarks'], expand: [{ ref: ['label'] }] }]
 *   Output effectiveQuery.columns: [*, ID]  (sourceKey injected)
 *   Output localExpandItems: [{ ref: ['bookmarks'], expand: [...] }]
 */
function splitLocalExpands(query, localAssocsByName) {
    const sel = query?.SELECT
    if (!sel?.columns || !localAssocsByName || localAssocsByName.size === 0) {
        return { localExpandItems: [], effectiveQuery: query }
    }

    const hasLocalExpands = sel.columns.some(
        col => col.expand && col.ref && localAssocsByName.has(col.ref[0])
    )
    if (!hasLocalExpands) {
        return { localExpandItems: [], effectiveQuery: query }
    }

    LOG.debug(`Splitting ${sel.columns.filter(c => c.expand && localAssocsByName.has(c.ref?.[0])).length} local expand(s) from remote query`)
    const cloned = cds.ql.clone(query)
    const localExpandItems = []
    const remainingColumns = []

    for (const col of cloned.SELECT.columns) {
        if (col.expand && col.ref && localAssocsByName.has(col.ref[0])) {
            localExpandItems.push(col)
        } else {
            remainingColumns.push(col)
        }
    }

    const hasWildcard = remainingColumns.some(c => c === '*' || c['*'])
    if (!hasWildcard) {
        for (const expandItem of localExpandItems) {
            const assoc = localAssocsByName.get(expandItem.ref[0])
            if (assoc && !remainingColumns.some(c => c.ref?.[0] === assoc.sourceKey)) {
                remainingColumns.push({ ref: [assoc.sourceKey] })
            }
        }
    }

    cloned.SELECT.columns = remainingColumns
    LOG.debug(`Remote query retains ${remainingColumns.length} column(s); ${localExpandItems.length} local expand(s) deferred for stitching`)
    return { localExpandItems, effectiveQuery: cloned }
}

/**
 * Resolves cross-service expand: remote → local by querying the local DB
 * and stitching results into the remote entity data.
 *
 * Customers with bookmarks expand:
 *   Local query: SELECT customer_ID, label FROM Bookmarks WHERE customer_ID in ['C001','C002']
 *   Output: records[].bookmarks = [{ label: '...' }, ...]
 */
async function resolveRemoteToLocalExpands(results, expandItems, localAssocsByName, service) {
    const records = Array.isArray(results) ? results : [results]
    if (records.length === 0) return

    for (const expandItem of expandItems) {
        const assocName = expandItem.ref[0]
        const assoc = localAssocsByName.get(assocName)
        if (!assoc) continue

        const keyValues = [...new Set(records.map(r => r[assoc.sourceKey]).filter(v => v != null))]
        if (keyValues.length === 0) {
            for (const rec of records) rec[assocName] = assoc.is2many ? [] : null
            continue
        }

        const targetShortName = assoc.target.split('.').pop()
        const q = SELECT.from(targetShortName).where({ [assoc.fkColumn]: { in: keyValues } })

        LOG.debug(`Cross-service expand (remote → local) '${assocName}': querying ${targetShortName} for ${keyValues.length} source key(s)`)

        if (expandItem.expand && Array.isArray(expandItem.expand)) {
            const hasWildcard = expandItem.expand.some(c => c === '*' || c['*'])
            if (!hasWildcard) {
                const innerCols = expandItem.expand.filter(c => c.ref).map(c => ({ ref: c.ref }))
                if (!innerCols.some(c => c.ref?.[0] === assoc.fkColumn)) {
                    innerCols.push({ ref: [assoc.fkColumn] })
                }
                if (innerCols.length > 0) q.columns(innerCols)
            }
        }

        if (expandItem.where) {
            q.SELECT.where.push('and', ...expandItem.where)
        }

        if (expandItem.orderBy) {
            q.SELECT.orderBy = expandItem.orderBy
        }

        const localResults = await service.run(q)
        LOG.debug(`Stitching '${assocName}': ${localResults.length} local row(s) into ${records.length} remote record(s)`)

        if (assoc.is2many) {
            const lookup = new Map()
            for (const r of localResults) {
                const key = r[assoc.fkColumn]
                if (!lookup.has(key)) lookup.set(key, [])
                lookup.get(key).push(r)
            }
            const limitRows = expandItem.limit?.rows?.val
            const limitOffset = expandItem.limit?.offset?.val || 0
            for (const rec of records) {
                let items = lookup.get(rec[assoc.sourceKey]) || []
                if (limitRows != null || limitOffset) {
                    items = items.slice(limitOffset, limitRows != null ? limitOffset + limitRows : undefined)
                }
                rec[assocName] = items
            }
        } else {
            const lookup = new Map()
            for (const r of localResults) {
                lookup.set(r[assoc.fkColumn], r)
            }
            for (const rec of records) {
                rec[assocName] = lookup.get(rec[assoc.sourceKey]) || null
            }
        }
    }
}

module.exports = { buildLocalAssocInfo, splitLocalExpands, resolveRemoteToLocalExpands }
