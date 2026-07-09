/**
 * Helpers for consumption-view column refs — single-segment and flattened
 * association paths (e.g. customer.name as buyerName).
 */

/**
 * @param {object} col - CSN projection column `{ ref, as? }`
 * @returns {string|null} Dotted remote path, e.g. `customer.name`
 */
function columnRefToRemotePath(col) {
    if (!col?.ref?.length) return null
    return col.ref.join('.')
}

/**
 * CQN `.columns(...)` argument for a projection column.
 * Single-segment columns stay as bare strings for backward compatibility.
 *
 * @param {object} col
 * @returns {string|object|null}
 */
function columnRefToSelectArg(col) {
    if (!col?.ref?.length) return null
    if (col.ref.length === 1) {
        return col.as ? { ref: col.ref, as: col.as } : col.ref[0]
    }
    return col.as ? { ref: col.ref, as: col.as } : { ref: col.ref }
}

/**
 * @param {object} col - CSN projection column
 * @returns {{
 *   selectArg: string|object,
 *   remotePath: string,
 *   localName: string,
 *   hasRename: boolean
 * }|null}
 */
function extractColumnMapping(col) {
    const remotePath = columnRefToRemotePath(col)
    if (!remotePath) return null

    const selectArg = columnRefToSelectArg(col)
    const localName = col.as || col.ref[col.ref.length - 1]

    return {
        selectArg,
        remotePath,
        localName,
        hasRename: Boolean(col.as),
    }
}

/**
 * Walk projection.columns and build viewMapping select + rename maps.
 *
 * @param {object[]} columns
 * @returns {{
 *   projectedColumns: Array<string|object>,
 *   localToRemote: Record<string, string>,
 *   remoteToLocal: Record<string, string>
 * }}
 */
function buildColumnMappingsFromProjection(columns) {
    const projectedColumns = []
    const localToRemote = {}
    const remoteToLocal = {}

    for (const col of columns) {
        const mapped = extractColumnMapping(col)
        if (!mapped) continue

        projectedColumns.push(mapped.selectArg)
        if (mapped.hasRename) {
            localToRemote[mapped.localName] = mapped.remotePath
            remoteToLocal[mapped.remotePath] = mapped.localName
            // HCQL/CQN may return aliased keys directly in the result row.
            remoteToLocal[mapped.localName] = mapped.localName
        }
    }

    return { projectedColumns, localToRemote, remoteToLocal }
}

function projectedColumnToRemoteSelectRef(col) {
    if (typeof col === 'string') return { ref: [col] }
    if (col?.ref?.length) return { ref: col.ref }
    return col
}

function projectedColumnToSelectArg(col) {
    if (typeof col === 'string') return { ref: [col] }
    if (col?.ref?.length) return col.as ? { ref: col.ref, as: col.as } : { ref: col.ref }
    return col
}

function projectedColumnToRemoteKey(col) {
    if (typeof col === 'string') return col
    return columnRefToRemotePath(col) || col
}

module.exports = {
    columnRefToRemotePath,
    columnRefToSelectArg,
    extractColumnMapping,
    buildColumnMappingsFromProjection,
    projectedColumnToSelectArg,
    projectedColumnToRemoteKey,
    projectedColumnToRemoteSelectRef,
}
