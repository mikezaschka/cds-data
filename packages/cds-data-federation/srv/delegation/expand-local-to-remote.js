const cds = require('@sap/cds')
const { projectedColumnToRemoteSelectRef } = require('cds-data-pipeline/srv/lib/columnRefPath')
const { resolveRemoteNavigationFilters } = require('./remote-navigation-filters')
const { rewriteRemoteToLocalNavigation } = require('./cross-service-navigation')

const LOG = cds.log('cds-data-federation')

/**
 * For each local entity in a service that has associations to federated entities,
 * register an on('READ') handler that:
 *   1. Pre-resolves cross-service navigation path filters (query splitting)
 *   2. Splitting federated expands from the query
 *   3. Calling next() to fetch local data
 *   4. Batch-fetching the federated data via the delegate logic
 *   5. Stitching results into the local records
 */
function registerLocalExpandResolvers(service, federatedMap, viewMappingRegistry) {
    if (!service || !service.entities) return

    for (const entity of service.entities) {
        if (federatedMap.has(entity.name)) continue
        if (!entity.elements) continue

        const fedAssocs = []
        for (const [elemName, elem] of Object.entries(entity.elements)) {
            if (!elem.target) continue
            if (!federatedMap.has(elem.target)) continue

            const is2many = !!elem.is2many || (elem.cardinality?.max === '*')
            const assocInfo = {
                name: elemName,
                target: elem.target,
                keys: elem.keys || [],
                is2many,
                federation: federatedMap.get(elem.target)
            }

            if (is2many && elem.on) {
                const parsed = parseOnCondition(elem.on, elemName)
                if (parsed) {
                    if (!parsed.localField) {
                        const pk = Object.entries(entity.elements).find(([, e]) => e.key)?.[0]
                        parsed.localField = pk || 'ID'
                    }
                    assocInfo.onJoin = parsed
                }
            }

            fedAssocs.push(assocInfo)
        }

        if (fedAssocs.length === 0) continue

        const shortName = entity.name.split('.').pop()
        const assocByName = new Map(fedAssocs.map(a => [a.name, a]))

        service.prepend(function () {
            service.on('READ', shortName, async (req, next) => {
                if (rewriteRemoteToLocalNavigation(req.query, shortName, assocByName)) {
                    return next()
                }

                const navResult = resolveRemoteNavigationFilters(req.query, assocByName)
                if (navResult instanceof Promise) {
                    req.query = (await navResult)._cqn
                }

                const lambdaResult = resolveRemoteLambdaFilters(req.query, assocByName)
                if (lambdaResult instanceof Promise) {
                    req.query = (await lambdaResult)._cqn
                }

                const sel = req.query?.SELECT
                if (!sel?.columns) return next()

                const fedExpands = []
                const remainingColumns = []
                for (const col of sel.columns) {
                    if (col.expand && col.ref && assocByName.has(col.ref[0])) {
                        fedExpands.push(col)
                    } else {
                        remainingColumns.push(col)
                    }
                }

                if (fedExpands.length === 0) return next()

                const requiredFKs = new Set()
                for (const expandItem of fedExpands) {
                    const assoc = assocByName.get(expandItem.ref[0])
                    if (assoc.is2many && assoc.onJoin) {
                        requiredFKs.add(assoc.onJoin.localField)
                    } else {
                        for (const key of assoc.keys) {
                            const keyName = Array.isArray(key.ref) ? key.ref[0] : key
                            requiredFKs.add(`${assoc.name}_${keyName}`)
                        }
                    }
                }
                const hasWildcard = remainingColumns.some(c => c === '*' || c['*'])
                if (!hasWildcard) {
                    for (const fk of requiredFKs) {
                        const exists = remainingColumns.some(c => c.ref && c.ref[0] === fk)
                        if (!exists) remainingColumns.push({ ref: [fk] })
                    }
                }

                sel.columns = remainingColumns

                const localResults = await next()
                if (!localResults || (Array.isArray(localResults) && localResults.length === 0)) {
                    return localResults
                }
                const records = Array.isArray(localResults) ? localResults : [localResults]

                for (const expandItem of fedExpands) {
                    const assoc = assocByName.get(expandItem.ref[0])
                    if (assoc.is2many) {
                        await resolveFederatedToManyExpand(records, expandItem, assoc, viewMappingRegistry)
                    } else {
                        await resolveFederatedExpand(records, expandItem, assoc, viewMappingRegistry)
                    }
                }

                return localResults
            })
        })
        LOG.info(`Registered local expand resolver for ${entity.name} (associations: ${fedAssocs.map(a => a.name).join(', ')})`)
    }
}

/**
 * Parses an unmanaged association's ON condition to extract join columns.
 * Returns { localField, remoteField } where remoteField is the local (consumer) name.
 */
function parseOnCondition(on, assocName) {
    if (!Array.isArray(on)) return null
    for (let i = 0; i < on.length; i++) {
        if (on[i] !== '=') continue
        const left = on[i - 1]
        const right = on[i + 1]
        if (!left?.ref || !right?.ref) continue

        let remoteSide, localSide
        if (left.ref[0] === assocName && left.ref.length >= 2) {
            remoteSide = left.ref.slice(1)
            localSide = right.ref
        } else if (right.ref[0] === assocName && right.ref.length >= 2) {
            remoteSide = right.ref.slice(1)
            localSide = left.ref
        } else continue

        const remoteField = remoteSide[0]
        let localField
        if (localSide[0] === '$self') {
            localField = localSide.length > 1 ? localSide[1] : null
        } else {
            localField = localSide[localSide.length - 1]
        }
        return { localField, remoteField }
    }
    return null
}

/**
 * Translates field refs in an inner expand WHERE clause from local to remote names.
 * Returns a new array (does not mutate the original).
 */
function translateExpandWhere(where, localToRemote) {
    if (!Array.isArray(where)) return where
    return where.map(node => {
        if (node?.ref) {
            const translatedRef = node.ref.map(seg =>
                typeof seg === 'string' ? (localToRemote[seg] || seg) : seg
            )
            return { ...node, ref: translatedRef }
        }
        if (node?.func && Array.isArray(node.args)) {
            return { ...node, args: translateExpandWhere(node.args, localToRemote) }
        }
        if (node?.xpr) {
            return { ...node, xpr: translateExpandWhere(node.xpr, localToRemote) }
        }
        return node
    })
}

// ─── Remote Lambda Filter Resolution (cross-service filter: local → remote) ─
//
// When a local entity has to-many associations to federated entities, the client
// can filter using lambdas: ProductCategories?$filter=products/any(p:p/unitPrice gt 100)
//
// CAP parses this into an `exists` CQN expression referencing the federated association.
// The local DB can't resolve it (no remote table). We pre-resolve by querying the
// remote service, collecting matching join values, and rewriting to a local IN filter.
//
// ProductCategories?$filter=products/any(p:p/unitPrice gt 100)
//   Input  CQN.where: [ 'exists', { ref: [{ id: 'products', where: [{ ref: ['unitPrice'] }, '>', { val: 100 }] }] } ]
//   Output CQN.where: [ { ref: ['categoryId'] }, 'in', { list: [{ val: 'CAT1' }, ...] } ]

function resolveRemoteLambdaFilters(query, fedAssocByName) {
    const where = query?.SELECT?.where
    if (!where || fedAssocByName.size === 0) return query
    if (!containsRemoteLambda(where, fedAssocByName)) return query

    LOG.debug('Detected remote-association lambda filter (local → remote); pre-resolving via remote query')
    const cloned = cds.ql.clone(query)
    return rewriteRemoteLambdas(cloned.SELECT.where, fedAssocByName)
        .then(() => { return { _cqn: cloned } })
}

function containsRemoteLambda(where, fedAssocByName) {
    if (!Array.isArray(where)) return false
    for (let i = 0; i < where.length; i++) {
        if (where[i] === 'exists' || (where[i] === 'not' && where[i + 1] === 'exists')) {
            const existsIdx = where[i] === 'exists' ? i : i + 1
            const refItem = where[existsIdx + 1]
            if (refItem?.ref) {
                const firstSeg = refItem.ref[0]
                const assocName = typeof firstSeg === 'string' ? firstSeg : firstSeg?.id
                if (assocName && fedAssocByName.has(assocName) && fedAssocByName.get(assocName).is2many) {
                    return true
                }
            }
        }
        if (typeof where[i] === 'object' && where[i]?.xpr) {
            if (containsRemoteLambda(where[i].xpr, fedAssocByName)) return true
        }
    }
    return false
}

async function rewriteRemoteLambdas(where, fedAssocByName) {
    if (!Array.isArray(where)) return

    for (let i = 0; i < where.length; i++) {
        const isNot = where[i] === 'not' && where[i + 1] === 'exists'
        const isExists = where[i] === 'exists'

        if (!isExists && !isNot) {
            if (typeof where[i] === 'object' && where[i]?.xpr) {
                await rewriteRemoteLambdas(where[i].xpr, fedAssocByName)
            }
            continue
        }

        const existsIdx = isNot ? i + 1 : i
        const refItem = where[existsIdx + 1]
        if (!refItem?.ref) continue

        const firstSeg = refItem.ref[0]
        const assocName = typeof firstSeg === 'string' ? firstSeg : firstSeg?.id
        if (!assocName || !fedAssocByName.has(assocName)) continue

        const assoc = fedAssocByName.get(assocName)
        if (!assoc.is2many || !assoc.onJoin) continue

        const { sourceService, sourceEntity, viewMapping } = assoc.federation
        const { localToRemote = {} } = viewMapping || {}
        const innerWhere = typeof firstSeg === 'object' ? firstSeg.where : null

        const remote = await cds.connect.to(sourceService)
        const remoteEntity = remote.entities[sourceEntity]
        if (!remoteEntity) continue

        const remoteFieldLocal = assoc.onJoin.remoteField
        const remoteFieldTranslated = localToRemote[remoteFieldLocal] || remoteFieldLocal
        const isRemoteAssoc = !!remoteEntity.elements?.[remoteFieldTranslated]?.target
        const remoteFKColumn = isRemoteAssoc
            ? `${remoteFieldTranslated}_${findAssocKeyName(remoteEntity.elements[remoteFieldTranslated])}`
            : remoteFieldTranslated

        const q = SELECT.from(remoteEntity).columns(remoteFKColumn)
        if (innerWhere) {
            const translated = translateLambdaWhere(innerWhere, localToRemote)
            q.where(translated)
        }

        const results = await remote.run(q)
        const matchedKeys = [...new Set(results.map(r => r[remoteFKColumn]).filter(v => v != null))]

        const localField = assoc.onJoin.localField
        LOG.debug(`Remote lambda on '${assocName}': ${matchedKeys.length} matching ${localField} value(s) from ${sourceService}.${sourceEntity}`)
        let replacement
        const valList = { list: matchedKeys.map(v => ({ val: v })) }
        if (matchedKeys.length === 0) {
            replacement = isNot
                ? [{ val: 1 }, '=', { val: 1 }]
                : [{ val: 1 }, '=', { val: 0 }]
        } else if (isNot) {
            replacement = [{ ref: [localField] }, 'not in', valList]
        } else {
            replacement = [{ ref: [localField] }, 'in', valList]
        }

        const removeCount = isNot ? 3 : 2
        where.splice(i, removeCount, ...replacement)
        LOG.debug(`Rewrote ${isNot ? 'not exists' : 'exists'} on '${assocName}' → ${localField} ${isNot ? 'not in' : 'in'} filter`)
    }
}

function translateLambdaWhere(where, localToRemote) {
    if (!Array.isArray(where)) return where
    return where.map(node => {
        if (node?.ref) {
            const translatedRef = node.ref.map(seg =>
                typeof seg === 'string' ? (localToRemote[seg] || seg) : seg
            )
            return { ...node, ref: translatedRef }
        }
        if (node?.func && Array.isArray(node.args)) {
            return { ...node, args: translateLambdaWhere(node.args, localToRemote) }
        }
        if (node?.xpr) {
            return { ...node, xpr: translateLambdaWhere(node.xpr, localToRemote) }
        }
        return node
    })
}

const BATCH_FETCH_CHUNK_SIZE = 100

/**
 * Batch-fetches the target entity from the remote service for all foreign keys
 * collected from local records, then stitches the results back into each record.
 * Supports both single-key and composite-key associations (to-one).
 *
 * Reviews?$expand=product($select=productName)
 *   Input  local query columns: [*, product_ID]  (FK injected)
 *   Remote batch: SELECT name, ID FROM Products WHERE ID in ['P001','P002',...]
 *   Output: records[].product = { productName: '...', productId: '...' }
 */
async function resolveFederatedExpand(records, expandItem, assoc, viewMappingRegistry) {
    const { sourceService, sourceEntity, viewMapping } = assoc.federation
    const { localToRemote = {}, remoteToLocal = {} } = viewMapping || {}

    const keyDefs = assoc.keys.map(k => {
        const keyName = Array.isArray(k.ref) ? k.ref[0] : k
        return {
            local: keyName,
            remote: localToRemote[keyName] || keyName,
            fk: `${assoc.name}_${keyName}`
        }
    })

    if (keyDefs.length === 0) {
        LOG.warn(`No keys found for association ${assoc.name}; skipping expand`)
        return
    }

    const fkTupleSet = new Set()
    const fkTuples = []
    for (const rec of records) {
        const tuple = keyDefs.map(kd => rec[kd.fk])
        if (tuple.some(v => v == null)) continue
        const key = keyDefs.length === 1 ? String(tuple[0]) : JSON.stringify(tuple)
        if (!fkTupleSet.has(key)) {
            fkTupleSet.add(key)
            fkTuples.push(tuple)
        }
    }
    if (fkTuples.length === 0) {
        for (const rec of records) rec[assoc.name] = null
        return
    }

    LOG.debug(`Cross-service expand (local → remote) to-one '${assoc.name}': batch-fetching ${fkTuples.length} FK tuple(s) from ${sourceService}.${sourceEntity}`)

    const remote = await cds.connect.to(sourceService)
    const remoteEntity = remote.entities[sourceEntity]
    if (!remoteEntity) {
        throw new Error(`Entity '${sourceEntity}' not found in remote service '${sourceService}'`)
    }

    let innerColumns = buildInnerColumns(expandItem, localToRemote, viewMapping, keyDefs)

    if (innerColumns.length === 0 && viewMapping?.excludedColumns?.length > 0 && remoteEntity.elements) {
        const excluded = new Set(viewMapping.excludedColumns)
        for (const [elemName, elem] of Object.entries(remoteEntity.elements)) {
            if (excluded.has(elemName)) continue
            if (elem.target || elem.is2one || elem.is2many) continue
            innerColumns.push({ ref: [elemName] })
        }
        for (const kd of keyDefs) {
            if (!innerColumns.some(c => c.ref?.[0] === kd.remote)) {
                innerColumns.push({ ref: [kd.remote] })
            }
        }
    }

    const expandWhere = expandItem.where
        ? translateExpandWhere(expandItem.where, localToRemote)
        : null

    const expandOrderBy = expandItem.orderBy
        ? expandItem.orderBy.map(o => {
            if (!o.ref) return o
            const translatedRef = o.ref.map(seg =>
                typeof seg === 'string' ? (localToRemote[seg] || seg) : seg
            )
            return { ...o, ref: translatedRef }
        })
        : null

    const allResults = []

    if (keyDefs.length === 1) {
        const fkValues = fkTuples.map(t => t[0])
        const chunks = []
        for (let i = 0; i < fkValues.length; i += BATCH_FETCH_CHUNK_SIZE) {
            chunks.push(fkValues.slice(i, i + BATCH_FETCH_CHUNK_SIZE))
        }
        LOG.debug(`Batch-fetching '${assoc.name}' in ${chunks.length} chunk(s) of up to ${BATCH_FETCH_CHUNK_SIZE} keys`)
        for (const chunk of chunks) {
            const q = SELECT.from(remoteEntity).where({ [keyDefs[0].remote]: { in: chunk } })
            if (innerColumns.length > 0) q.columns(innerColumns)
            if (expandWhere) q.SELECT.where.push('and', ...expandWhere)
            if (expandOrderBy) q.SELECT.orderBy = expandOrderBy
            const results = await remote.run(q)
            allResults.push(...results)
        }
    } else {
        const chunks = []
        for (let i = 0; i < fkTuples.length; i += BATCH_FETCH_CHUNK_SIZE) {
            chunks.push(fkTuples.slice(i, i + BATCH_FETCH_CHUNK_SIZE))
        }
        for (const chunk of chunks) {
            const orConditions = chunk.map(tuple => {
                const andParts = keyDefs.map((kd, idx) =>
                    [{ ref: [kd.remote] }, '=', { val: tuple[idx] }]
                )
                const flat = andParts.reduce((acc, part, i) =>
                    i === 0 ? part : [...acc, 'and', ...part], [])
                return { xpr: flat }
            })
            const whereArray = orConditions.reduce((acc, part, i) =>
                i === 0 ? [part] : [...acc, 'or', part], [])
            const q = SELECT.from(remoteEntity)
            q.SELECT.where = whereArray
            if (innerColumns.length > 0) q.columns(innerColumns)
            if (expandWhere) q.SELECT.where.push('and', ...expandWhere)
            if (expandOrderBy) q.SELECT.orderBy = expandOrderBy
            const results = await remote.run(q)
            allResults.push(...results)
        }
    }

    const lookup = new Map()
    for (const r of allResults) {
        const lookupKey = keyDefs.length === 1
            ? r[keyDefs[0].remote]
            : JSON.stringify(keyDefs.map(kd => r[kd.remote]))
        const mapped = mapResultWithNestedExpands(r, remoteToLocal, remoteEntity, viewMappingRegistry)
        lookup.set(lookupKey, mapped)
    }

    for (const rec of records) {
        const hasNull = keyDefs.some(kd => rec[kd.fk] == null)
        if (hasNull) {
            rec[assoc.name] = null
            continue
        }
        const lookupKey = keyDefs.length === 1
            ? rec[keyDefs[0].fk]
            : JSON.stringify(keyDefs.map(kd => rec[kd.fk]))
        rec[assoc.name] = lookup.get(lookupKey) || null
    }
    LOG.debug(`Stitched to-one expand '${assoc.name}' into ${records.length} record(s); ${lookup.size} remote row(s) fetched`)
}

/**
 * Resolves a to-many cross-service expand: local → remote.
 * The FK lives on the remote entity; the local entity's field matches the remote FK value.
 * Queries remote with FK IN [local values], groups results into arrays, and stitches.
 *
 * ProductCategories?$expand=products($select=productName)
 *   Input  local values: ['CAT1','CAT2']
 *   Remote batch: SELECT name, categoryId FROM Products WHERE categoryId in ['CAT1','CAT2']
 *   Output: records[].products = [{ productName: '...' }, ...]
 */
async function resolveFederatedToManyExpand(records, expandItem, assoc, viewMappingRegistry) {
    const { sourceService, sourceEntity, viewMapping } = assoc.federation
    const { localToRemote = {}, remoteToLocal = {} } = viewMapping || {}

    const onJoin = assoc.onJoin
    if (!onJoin) {
        LOG.warn(`Cannot resolve to-many association '${assoc.name}': no join info from ON condition`)
        for (const rec of records) rec[assoc.name] = []
        return
    }

    const localField = onJoin.localField
    const remoteFieldLocal = onJoin.remoteField

    const localValues = [...new Set(
        records.map(r => r[localField]).filter(v => v != null)
    )]
    if (localValues.length === 0) {
        for (const rec of records) rec[assoc.name] = []
        return
    }

    LOG.debug(`Cross-service expand (local → remote) to-many '${assoc.name}': batch-fetching for ${localValues.length} local value(s) from ${sourceService}.${sourceEntity}`)

    const remote = await cds.connect.to(sourceService)
    const remoteEntity = remote.entities[sourceEntity]
    if (!remoteEntity) {
        throw new Error(`Entity '${sourceEntity}' not found in remote service '${sourceService}'`)
    }

    const remoteFieldTranslated = localToRemote[remoteFieldLocal] || remoteFieldLocal
    const isRemoteAssoc = !!remoteEntity.elements?.[remoteFieldTranslated]?.target
    const remoteFKColumn = isRemoteAssoc
        ? `${remoteFieldTranslated}_${findAssocKeyName(remoteEntity.elements[remoteFieldTranslated])}`
        : remoteFieldTranslated

    let innerColumns = buildInnerColumns(expandItem, localToRemote, viewMapping, null)
    if (innerColumns.length === 0 && viewMapping?.excludedColumns?.length > 0 && remoteEntity.elements) {
        const excluded = new Set(viewMapping.excludedColumns)
        for (const [elemName, elem] of Object.entries(remoteEntity.elements)) {
            if (excluded.has(elemName)) continue
            if (elem.target || elem.is2one || elem.is2many) continue
            innerColumns.push({ ref: [elemName] })
        }
    }
    if (innerColumns.length > 0 && !innerColumns.some(c => c.ref?.[0] === remoteFKColumn)) {
        innerColumns.push({ ref: [remoteFKColumn] })
    }

    const expandWhere = expandItem.where
        ? translateExpandWhere(expandItem.where, localToRemote)
        : null

    const expandOrderBy = expandItem.orderBy
        ? expandItem.orderBy.map(o => {
            if (!o.ref) return o
            const translatedRef = o.ref.map(seg =>
                typeof seg === 'string' ? (localToRemote[seg] || seg) : seg
            )
            return { ...o, ref: translatedRef }
        })
        : null

    const allResults = []
    const chunks = []
    for (let i = 0; i < localValues.length; i += BATCH_FETCH_CHUNK_SIZE) {
        chunks.push(localValues.slice(i, i + BATCH_FETCH_CHUNK_SIZE))
    }
    LOG.debug(`Batch-fetching to-many '${assoc.name}' in ${chunks.length} chunk(s) of up to ${BATCH_FETCH_CHUNK_SIZE} keys`)
    for (const chunk of chunks) {
        const q = SELECT.from(remoteEntity).where({ [remoteFKColumn]: { in: chunk } })
        if (innerColumns.length > 0) q.columns(innerColumns)
        if (expandWhere) q.SELECT.where.push('and', ...expandWhere)
        if (expandOrderBy) q.SELECT.orderBy = expandOrderBy
        const results = await remote.run(q)
        allResults.push(...results)
    }

    const lookup = new Map()
    for (const r of allResults) {
        const key = r[remoteFKColumn]
        const mapped = mapResultWithNestedExpands(r, remoteToLocal, remoteEntity, viewMappingRegistry)
        if (!lookup.has(key)) lookup.set(key, [])
        lookup.get(key).push(mapped)
    }

    const limitRows = expandItem.limit?.rows?.val
    const limitOffset = expandItem.limit?.offset?.val || 0
    for (const rec of records) {
        let items = lookup.get(rec[localField]) || []
        if (limitRows != null || limitOffset) {
            items = items.slice(limitOffset, limitRows != null ? limitOffset + limitRows : undefined)
        }
        rec[assoc.name] = items
    }
    LOG.debug(`Stitched to-many expand '${assoc.name}' into ${records.length} record(s); ${allResults.length} remote row(s) fetched`)
}

function findAssocKeyName(assocElem) {
    if (assocElem?.keys?.length > 0) {
        const keyRef = assocElem.keys[0].ref
        return Array.isArray(keyRef) ? keyRef[0] : keyRef
    }
    return 'ID'
}

/**
 * Maps a remote result row to local field names, recursively mapping
 * expanded associations using the viewMappingRegistry.
 */
function mapResultWithNestedExpands(row, remoteToLocal, remoteEntityDef, viewMappingRegistry) {
    const mapped = {}
    for (const [k, v] of Object.entries(row)) {
        const localKey = remoteToLocal[k] || k

        if (v != null && typeof v === 'object' && !(v instanceof Date) && remoteEntityDef?.elements) {
            const elemDef = remoteEntityDef.elements[k]
            if (elemDef?.target) {
                const targetMapping = viewMappingRegistry[elemDef.target]
                const innerR2L = targetMapping?.remoteToLocal
                if (innerR2L && Object.keys(innerR2L).length > 0) {
                    if (Array.isArray(v)) {
                        mapped[localKey] = v.map(item => mapFlatWithFKs(item, innerR2L))
                    } else {
                        mapped[localKey] = mapFlatWithFKs(v, innerR2L)
                    }
                    continue
                }
            }
        }

        mapped[localKey] = v
    }
    return mapped
}

/**
 * Maps a result row using remoteToLocal, including FK column renames.
 * E.g., if remoteToLocal has { customer: 'buyer' }, then
 * 'customer_ID' is renamed to 'buyer_ID'.
 */
function mapFlatWithFKs(row, remoteToLocal) {
    const mapped = {}
    for (const [k, v] of Object.entries(row)) {
        let localKey = remoteToLocal[k]
        if (!localKey) {
            for (const [remoteName, localName] of Object.entries(remoteToLocal)) {
                const prefix = remoteName + '_'
                if (k.startsWith(prefix)) {
                    localKey = localName + '_' + k.substring(prefix.length)
                    break
                }
            }
        }
        mapped[localKey || k] = v
    }
    return mapped
}

/**
 * Builds the column list for the inner (remote batch-fetch) query.
 * Handles explicit $select, nested $expand forwarding, projected columns, and key inclusion.
 *
 * $expand=product($select=productName,unitPrice)
 *   Input  expand columns: [{ ref: ['productName'] }, { ref: ['unitPrice'] }]
 *   Output remote columns: [{ ref: ['name'] }, { ref: ['price'] }]  (via localToRemote)
 *
 * @param {Array|null} keyDefs - array of key definitions (null for to-many)
 */
function buildInnerColumns(expandItem, localToRemote, viewMapping, keyDefs) {
    const innerColumns = []
    let hasWildcardWithExpand = false

    if (expandItem.expand && Array.isArray(expandItem.expand)) {
        const hasInnerWildcard = expandItem.expand.some(c => c === '*' || c['*'])
        const innerExpands = expandItem.expand.filter(c => c.expand)

        if (!hasInnerWildcard) {
            for (const col of expandItem.expand) {
                if (col.expand) {
                    const translatedRef = col.ref.map(seg =>
                        typeof seg === 'string' ? (localToRemote[seg] || seg) : seg
                    )
                    innerColumns.push({ ...col, ref: translatedRef })
                } else if (col.ref) {
                    innerColumns.push({ ref: [localToRemote[col.ref[0]] || col.ref[0]] })
                }
            }
        } else if (innerExpands.length > 0) {
            innerColumns.push('*')
            for (const col of innerExpands) {
                const translatedRef = col.ref.map(seg =>
                    typeof seg === 'string' ? (localToRemote[seg] || seg) : seg
                )
                innerColumns.push({ ...col, ref: translatedRef })
            }
            hasWildcardWithExpand = true
        }
    }

    if (innerColumns.length === 0 && !viewMapping?.isWildcard && viewMapping?.projectedColumns?.length > 0) {
        for (const col of viewMapping.projectedColumns) {
            innerColumns.push(projectedColumnToRemoteSelectRef(col))
        }
    }
    if (innerColumns.length > 0 && !hasWildcardWithExpand && keyDefs) {
        for (const kd of keyDefs) {
            if (!innerColumns.some(c => c.ref?.[0] === kd.remote)) {
                innerColumns.push({ ref: [kd.remote] })
            }
        }
    }
    return innerColumns
}

module.exports = { registerLocalExpandResolvers }
