/**
 * Extracts pipeline viewMapping from a CDS entity definition that uses a projection
 * (consumption view). Aligns with cds-data-federation's extractViewMapping logic.
 *
 * @param {object} entityDef - CSN definition for the target entity
 * @returns {{
 *   isWildcard: boolean,
 *   excludedColumns: string[],
 *   projectedColumns: string[],
 *   localToRemote: Record<string, string>,
 *   remoteToLocal: Record<string, string>,
 *   staticWhere: object | null
 * }}
 */
function extractViewMappingFromEntityDef(entityDef) {
    if (!entityDef || typeof entityDef !== 'object') {
        return null
    }

    const projection = entityDef.projection || _projectionFromQuery(entityDef.query)
    if (!projection) {
        return null
    }

    const staticWhere = projection.where || null
    const columns = projection.columns
    const excluding = projection.excluding

    if (!columns || columns.length === 0) {
        const excludedColumns = excluding
            ? excluding.map(e => (typeof e === 'string' ? e : e.ref?.[0] || e)).filter(Boolean)
            : []
        return {
            isWildcard: true,
            excludedColumns,
            projectedColumns: [],
            localToRemote: {},
            remoteToLocal: {},
            staticWhere,
        }
    }

    if (columns.some(c => c === '*' || (c && c['*']))) {
        return {
            isWildcard: true,
            excludedColumns: [],
            projectedColumns: [],
            localToRemote: {},
            remoteToLocal: {},
            staticWhere,
        }
    }

    const projectedColumns = []
    const localToRemote = {}
    const remoteToLocal = {}

    for (const col of columns) {
        const remoteName = col.ref?.[0]
        if (!remoteName) continue

        const localName = col.as || remoteName
        projectedColumns.push(remoteName)
        if (col.as) {
            localToRemote[localName] = remoteName
            remoteToLocal[remoteName] = localName
        }
    }

    return {
        isWildcard: false,
        excludedColumns: [],
        projectedColumns,
        localToRemote,
        remoteToLocal,
        staticWhere,
    }
}

function _projectionFromQuery(query) {
    if (!query || !query.SELECT) return null
    const sel = query.SELECT
    const columns = sel.columns
    const from = sel.from
    if (!columns || !from) return null
    return {
        columns,
        excluding: sel.excluding,
        where: sel.where,
        from,
    }
}

module.exports = { extractViewMappingFromEntityDef }
