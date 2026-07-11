const cds = require('@sap/cds')
const { projectedColumnToSelectArg } = require('cds-data-pipeline/srv/lib/columnRefPath')

const LOG = cds.log('cds-data-federation')

// ─── Cross-Service Navigation Resolution (4.2.12) ───────────────────────────────
//
// When an OData client navigates across a local/remote boundary (e.g.,
// GET /Reviews(id)/product or GET /Customers('C001')/bookmarks),
// CAP cannot resolve this via SQL because one side has no local table.
//
// Two sub-cases:
//   local → remote: source is local, target is delegated.
//       Read local FK, then query remote by key.
//   remote → local: source is delegated, target is local.
//       Extract source key from from.ref, query local by FK.

/**
 * Resolves cross-service navigation: local → remote.
 * Source is a LOCAL entity, target is a REMOTE (delegated) entity.
 *
 * Example: GET /Reviews('id')/product
 *   Input  CQN.from.ref: [{ id: 'ConsumerService.Reviews', where: [...] }, 'product']
 *   Step 1: SELECT product_ID FROM Reviews WHERE ...
 *   Step 2: SELECT.one name, ID FROM ProviderService.Products WHERE ID = fkValue
 *   Output: { productName: '...', productId: '...' }
 *
 * @param {object} req - CAP request
 * @param {object} remote - connected remote service
 * @param {object} service - local application service
 * @param {string} sourceServiceName - remote service name
 * @param {object} viewMapping - view mapping for the target (delegated) entity
 */
async function resolveLocalToRemoteNavigation(req, remote, service, sourceServiceName, viewMapping) {
    const fromRef = req.query.SELECT.from.ref
    const sourceSegment = fromRef[0]
    const sourceEntityId = typeof sourceSegment === 'string' ? sourceSegment : sourceSegment.id
    const sourceWhere = typeof sourceSegment === 'object' ? sourceSegment.where : null
    const navProp = typeof fromRef[1] === 'string' ? fromRef[1] : fromRef[1]?.id

    const sourceShortName = sourceEntityId.split('.').pop()
    const sourceDef = cds.model?.definitions?.[sourceEntityId]
        || cds.model?.definitions?.[`${service.name}.${sourceShortName}`]
    if (!sourceDef?.elements) {
        LOG.warn(`Navigation: source entity '${sourceEntityId}' not found`)
        return null
    }

    const assocElem = sourceDef.elements[navProp]
    if (!assocElem?.keys?.length) {
        LOG.warn(`Navigation: association '${navProp}' has no keys on '${sourceEntityId}'`)
        return null
    }

    const keyName = Array.isArray(assocElem.keys[0].ref) ? assocElem.keys[0].ref[0] : assocElem.keys[0]
    const fkColumn = `${navProp}_${keyName}`

    LOG.debug(`Cross-service navigation (local → remote): reading ${fkColumn} from local ${sourceShortName}`)
    const sourceRecord = await service.run(
        SELECT.one.from(sourceShortName).columns(fkColumn).where(sourceWhere)
    )
    if (!sourceRecord) return null

    const fkValue = sourceRecord[fkColumn]
    if (fkValue == null) return null

    const { localToRemote = {}, remoteToLocal = {}, sourceEntity, projectedColumns, isWildcard } = viewMapping || {}
    const remoteKeyName = localToRemote[keyName] || keyName
    const remoteEntityFullName = `${sourceServiceName}.${sourceEntity}`

    LOG.debug(`Cross-service navigation (local → remote): querying ${remoteEntityFullName} by ${remoteKeyName}=${fkValue}`)
    const q = SELECT.one.from(remoteEntityFullName).where({ [remoteKeyName]: fkValue })

    const columns = req.query.SELECT.columns
    if (columns && !columns.some(c => c === '*' || c['*'])) {
        const remoteCols = []
        for (const col of columns) {
            if (col.ref) {
                const translated = col.ref.map(seg =>
                    typeof seg === 'string' ? (localToRemote[seg] || seg) : seg
                )
                remoteCols.push({ ref: translated })
            }
        }
        if (!remoteCols.some(c => c.ref?.[0] === remoteKeyName)) {
            remoteCols.push({ ref: [remoteKeyName] })
        }
        if (remoteCols.length > 0) q.columns(remoteCols)
    } else if (!isWildcard && projectedColumns?.length > 0) {
        q.columns(projectedColumns.map(c => projectedColumnToSelectArg(c)))
    }

    const result = await remote.run(q)
    if (!result) return null

    if (remoteToLocal && Object.keys(remoteToLocal).length > 0) {
        const mapped = {}
        for (const [k, v] of Object.entries(result)) {
            mapped[remoteToLocal[k] || k] = v
        }
        return mapped
    }
    return result
}

/**
 * Rewrites a cross-service navigation: remote → local CQN into a simple FK-filtered local query.
 *
 * Example: GET /Customers('C001')/bookmarks
 *   Input  CQN.from.ref: [{ id: 'ConsumerService.Customers', where: [...] }, 'bookmarks']
 *   Output CQN.from.ref: ['Bookmarks']
 *   Output CQN.where: [ { ref: ['customer_ID'] }, '=', { val: 'C001' } ]
 *
 * @param {object} query - CQN query (modified in-place)
 * @param {string} localEntityShortName - short name of this local entity
 * @param {Map} fedAssocByName - federated associations on this local entity
 * @returns {boolean} true if rewritten, false if not applicable
 */
function rewriteRemoteToLocalNavigation(query, localEntityShortName, fedAssocByName) {
    const fromRef = query?.SELECT?.from?.ref
    if (!Array.isArray(fromRef) || fromRef.length < 2) return false

    const sourceSegment = fromRef[0]
    const sourceEntityId = typeof sourceSegment === 'string' ? sourceSegment : sourceSegment.id
    if (!sourceEntityId) return false

    const sourceShortName = sourceEntityId.split('.').pop()

    let matchingAssoc = null
    for (const [, assocInfo] of fedAssocByName) {
        if (assocInfo.target.split('.').pop() === sourceShortName) {
            matchingAssoc = assocInfo
            break
        }
    }
    if (!matchingAssoc) return false

    const keyValue = extractKeyValue(sourceSegment)
    if (keyValue == null) return false

    const keyName = matchingAssoc.keys?.length > 0
        ? (Array.isArray(matchingAssoc.keys[0].ref) ? matchingAssoc.keys[0].ref[0] : matchingAssoc.keys[0])
        : 'ID'
    const fkColumn = `${matchingAssoc.name}_${keyName}`

    const sel = query.SELECT
    sel.from = { ref: [localEntityShortName] }
    const fkFilter = [{ ref: [fkColumn] }, '=', { val: keyValue }]
    if (sel.where && sel.where.length > 0) {
        sel.where = [...fkFilter, 'and', ...sel.where]
    } else {
        sel.where = fkFilter
    }

    LOG.debug(`Cross-service navigation (remote → local): rewrote from.ref to ${localEntityShortName} with ${fkColumn}=${keyValue}`)
    return true
}

/**
 * Extracts the primary key value from a navigation segment's where or args.
 */
function extractKeyValue(segment) {
    if (segment.where) {
        for (let i = 0; i < segment.where.length; i++) {
            if (segment.where[i] === '=' && i + 1 < segment.where.length) {
                const right = segment.where[i + 1]
                if (right?.val !== undefined) return right.val
            }
        }
    }
    if (segment.args) {
        if (typeof segment.args === 'object' && !Array.isArray(segment.args)) {
            return Object.values(segment.args)[0]
        }
    }
    return null
}

module.exports = { resolveLocalToRemoteNavigation, rewriteRemoteToLocalNavigation }
