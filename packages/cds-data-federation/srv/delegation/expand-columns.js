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

/**
 * Foreign key element names a managed to-one association contributes to its
 * source entity, e.g. `customer` with key `ID` yields `customer_ID`. To-many and
 * unmanaged associations own no foreign keys, so they yield nothing.
 */
function associationForeignKeyRefs(assocName, remoteEntityDef) {
    const element = remoteEntityDef?.elements?.[assocName]
    if (!element || element.is2many || !element.keys?.length) return []
    return element.keys
        .map(key => key.$generatedFieldName
            || (Array.isArray(key.ref) ? `${assocName}_${key.ref.join('_')}` : null))
        .filter(Boolean)
        .map(name => ({ ref: [name] }))
}

/** Translates a local field name using exact scalar and association-FK mappings. */
function remoteFieldName(name, localToRemote) {
    if (!localToRemote) return name
    return localToRemote[name] || name
}

/** Inverse of {@link remoteFieldName}; mappings are exact to avoid prefix collisions. */
function localFieldName(name, remoteToLocal) {
    if (!remoteToLocal) return name
    return remoteToLocal[name] || name
}

/**
 * Combines WHERE clauses with `and`, parenthesizing each so a clause containing
 * a top-level `or` cannot swallow the others.
 */
function andWhere(...clauses) {
    const present = clauses.filter(clause => Array.isArray(clause) && clause.length > 0)
    if (present.length === 0) return null
    if (present.length === 1) return present[0]
    return present
        .map(clause => (clause.length > 1 ? [{ xpr: clause }] : clause))
        .reduce((acc, clause) => [...acc, 'and', ...clause])
}

function projectedScalarColumns(viewMapping, remoteEntityDef) {
    const projectedColumns = viewMapping?.projectedColumns || []
    if (!viewMapping?.isWildcard && projectedColumns.length > 0) {
        const columns = []
        for (const col of projectedColumns) {
            if (isAssociationColumn(col, remoteEntityDef)) {
                // Associations belong in $expand, but their foreign keys are
                // structural properties the consumption view still exposes.
                columns.push(...associationForeignKeyRefs(projectedColumnRef(col)[0], remoteEntityDef))
            } else {
                columns.push(projectedColumnToRemoteSelectRef(col))
            }
        }
        return dedupeRefs(columns)
    }

    if (!remoteEntityDef?.elements) return []
    const excluded = new Set(viewMapping?.excludedColumns || [])
    const columns = []
    for (const [name, element] of Object.entries(remoteEntityDef.elements)) {
        if (excluded.has(name)) continue
        if (element.target || element.is2one || element.is2many) {
            columns.push(...associationForeignKeyRefs(name, remoteEntityDef))
        } else {
            columns.push({ ref: [name] })
        }
    }
    return dedupeRefs(columns)
}

function dedupeRefs(columns) {
    const seen = new Set()
    return columns.filter(col => {
        const key = col?.ref?.join('.')
        if (!key) return true
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

function translateExpandWhere(where, localToRemote) {
    if (!Array.isArray(where)) return where
    return where.map(node => {
        if (node?.ref) {
            const translatedRef = node.ref.map(seg =>
                typeof seg === 'string' ? remoteFieldName(seg, localToRemote) : seg
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

function translateOrderBy(orderBy, localToRemote) {
    if (!Array.isArray(orderBy)) return orderBy
    return orderBy.map(item => {
        if (!item?.ref) return item
        const translatedRef = item.ref.map(seg =>
            typeof seg === 'string' ? remoteFieldName(seg, localToRemote) : seg
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
                        typeof seg === 'string' ? remoteFieldName(seg, localToRemote) : seg
                    )
                    innerColumns.push({ ...col, ref: translatedRef })
                }
            } else if (!hasWildcard && col?.ref) {
                const translatedRef = col.ref.map(seg =>
                    typeof seg === 'string' ? remoteFieldName(seg, localToRemote) : seg
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
    andWhere,
    buildInnerColumns,
    localFieldName,
    projectedScalarColumns,
    remoteFieldName,
    translateExpandWhere,
    translateOrderBy,
}
