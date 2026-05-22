const cds = require('../runtime-cds')
const { mergeStaticWhereIntoSelect } = require('./mergeStaticWhereIntoSelect')

/**
 * One-shot read for ADR 0009 event `read: 'key'`: same `source.entity`,
 * `viewMapping` columns, and `staticWhere` as batch OData/CQN, plus `keys`
 * AND-combined with the static projection filter.
 *
 * @param {import('../runtime-cds').Service} service - `cds.connect.to(config.source.service)`
 * @param {object} config - normalized pipeline config
 * @param {Record<string, unknown>} keys - source (remote) field names → values
 * @returns {Promise<object[]>} 0, 1, or (if provider returns multiple) more rows
 */
async function fetchEventKeyBatch(service, config, keys) {
    if (!keys || typeof keys !== 'object' || Object.keys(keys).length === 0) {
        return []
    }
    const sourceConfig = config.source
    if (!sourceConfig || !sourceConfig.entity) {
        throw new Error('event read:key requires source.entity on the pipeline config')
    }
    const viewMapping = config.viewMapping || { isWildcard: true, projectedColumns: [] }
    let q = SELECT.from(sourceConfig.entity)
    if (!viewMapping.isWildcard && viewMapping.projectedColumns && viewMapping.projectedColumns.length > 0) {
        q = q.columns(viewMapping.projectedColumns)
    }
    q = q.where(keys)
    mergeStaticWhereIntoSelect(q, viewMapping.staticWhere)
    const res = await service.run(q)
    if (!res) return []
    return Array.isArray(res) ? res : [res]
}

module.exports = { fetchEventKeyBatch }
