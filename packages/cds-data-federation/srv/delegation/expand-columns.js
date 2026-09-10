const { projectedColumnToRemoteSelectRef } = require('cds-data-pipeline/srv/lib/columnRefPath')

function isWildcardColumn(col) {
    return col === '*' || col?.['*']
}

function projectedColumnRef(col) {
    if (typeof col === 'string') return [col]
    return col?.ref
}

function isAssociationColumn(col, remoteEntityDef) {
    const ref = projectedColumnRef(col)
    if (!ref?.length || ref.length > 1) return false
    const element = remoteEntityDef?.elements?.[ref[0]]
    return !!(element?.target || element?.is2one || element?.is2many)
}

function projectedScalarColumns(viewMapping, remoteEntityDef) {
    const projectedColumns = viewMapping?.projectedColumns || []
    if (!viewMapping?.isWildcard && projectedColumns.length > 0) {
        return projectedColumns
            .filter(col => !isAssociationColumn(col, remoteEntityDef))
            .map(col => projectedColumnToRemoteSelectRef(col))
    }

    if (!remoteEntityDef?.elements) return []
    const excluded = new Set(viewMapping?.excludedColumns || [])
    return Object.entries(remoteEntityDef.elements)
        .filter(([name, element]) =>
            !excluded.has(name)
            && !element.target
            && !element.is2one
            && !element.is2many
        )
        .map(([name]) => ({ ref: [name] }))
}

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

function translateExpandOrderBy(orderBy, localToRemote) {
    if (!Array.isArray(orderBy)) return orderBy
    return orderBy.map(item => {
        if (!item?.ref) return item
        const translatedRef = item.ref.map(seg =>
            typeof seg === 'string' ? (localToRemote[seg] || seg) : seg
        )
        return { ...item, ref: translatedRef }
    })
}

/**
 * Builds explicit remote columns for an expand item. Wildcards are replaced by
 * the target consumption view's scalar columns so OData v2 never receives nav/*.
 *
 * @param {Array|null} keyDefs - key definitions required by stitched to-one expands
 * @param {object} options - optional nested-expand mapper for recursive normalization
 */
function buildInnerColumns(
    expandItem,
    localToRemote,
    viewMapping,
    keyDefs,
    remoteEntityDef,
    options = {},
) {
    const innerColumns = []

    if (Array.isArray(expandItem.expand)) {
        const hasWildcard = expandItem.expand.some(isWildcardColumn)

        if (hasWildcard) {
            innerColumns.push(...projectedScalarColumns(viewMapping, remoteEntityDef))
        }

        for (const col of expandItem.expand) {
            if (isWildcardColumn(col)) continue
            if (col?.expand) {
                if (options.mapExpand) {
                    innerColumns.push(options.mapExpand(col))
                } else {
                    const translatedRef = col.ref.map(seg =>
                        typeof seg === 'string' ? (localToRemote[seg] || seg) : seg
                    )
                    innerColumns.push({ ...col, ref: translatedRef })
                }
            } else if (!hasWildcard && col?.ref) {
                const translatedRef = col.ref.map(seg =>
                    typeof seg === 'string' ? (localToRemote[seg] || seg) : seg
                )
                innerColumns.push({ ...col, ref: translatedRef })
            }
        }
    }

    if (innerColumns.length === 0) {
        innerColumns.push(...projectedScalarColumns(viewMapping, remoteEntityDef))
    }

    if (keyDefs) {
        for (const key of keyDefs) {
            if (!innerColumns.some(col => col.ref?.[0] === key.remote)) {
                innerColumns.push({ ref: [key.remote] })
            }
        }
    }

    return innerColumns
}

module.exports = {
    buildInnerColumns,
    isAssociationColumn,
    projectedScalarColumns,
    translateExpandOrderBy,
    translateExpandWhere,
}
