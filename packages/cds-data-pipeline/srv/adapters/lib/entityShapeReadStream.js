const cds = require('../../runtime-cds')
const { withRetry } = require('../../lib/retry')
const { mergeStaticWhereIntoSelect } = require('../../lib/mergeStaticWhereIntoSelect')
const { sourceAdapterRetryOptions } = require('./sourceAdapterRetryOptions')

function hasDeltaFilter(deltaFilter) {
    if (!deltaFilter) return false
    if (typeof deltaFilter === 'string') return deltaFilter.length > 0
    if (typeof deltaFilter === 'object') return Object.keys(deltaFilter).length > 0
    return false
}

function resolveSourceEntityRef(service, entity) {
    if (!entity || typeof entity !== 'string') return entity
    if (entity.includes('.')) return entity
    const kind = service?.options?.kind || service?.kind
    if (kind !== 'hcql') return entity
    const svc = service?.name
    return svc ? `${svc}.${entity}` : entity
}

/**
 * Shared entity-shape READ loop: build SELECT from source.entity + view mapping,
 * paginate with limit/skip, yield batches via service.run(query).
 *
 * @param {object} params
 * @param {object} params.service - Connected CAP service proxy
 * @param {object} params.config - Normalized pipeline config
 * @param {(delta: object, tracker: object, service: object) => object|string} params.buildDeltaFilter
 * @param {object} [params.retryOptions] - Optional withRetry options override
 * @param {boolean} [params.stopWhenPartialPage=false] - When true (local CQN/DB),
 *   stop after a batch smaller than batchSize. When false (remote remotes with
 *   server-driven page caps below batchSize), keep paging until an empty batch.
 */
async function* entityShapeReadStream({ service, config, tracker, buildDeltaFilter, retryOptions, stopWhenPartialPage = false }) {
    const sourceConfig = config.source
    const viewMapping = config.viewMapping || { isWildcard: true, projectedColumns: [] }
    const delta = config.delta || {}
    const retry = retryOptions || sourceAdapterRetryOptions(sourceConfig)

    let baseQuery = SELECT.from(resolveSourceEntityRef(service, sourceConfig.entity))

    if (!viewMapping.isWildcard && viewMapping.projectedColumns.length > 0) {
        baseQuery = baseQuery.columns(...viewMapping.projectedColumns)
    }

    const deltaFilter = buildDeltaFilter(delta, tracker, service)
    if (hasDeltaFilter(deltaFilter)) {
        baseQuery = baseQuery.where(deltaFilter)
    }

    mergeStaticWhereIntoSelect(baseQuery, viewMapping.staticWhere)

    const batchSize = sourceConfig.batchSize || 1000
    let skip = 0
    let hasMore = true

    while (hasMore) {
        if (sourceConfig.delay) {
            await new Promise(r => setTimeout(r, sourceConfig.delay))
        }

        // NB: cds.ql.clone() returns a prototype-linked clone — the source clauses
        // (from, columns, where, ...) live on the prototype, not as own properties.
        // A subsequent .limit() adds `limit` as the only OWN enumerable key. Wire
        // serializers that iterate own-enumerable keys (e.g. HCQL's Object.entries)
        // then drop `from`, so the remote receives a targetless SELECT and fails with
        // "Cannot determine target entity of query." Spread the source clauses into a
        // fresh, fully own-enumerable SELECT so `from` always survives serialization.
        const query = cds.ql.clone(baseQuery)
        query.SELECT = {
            ...baseQuery.SELECT,
            limit: { rows: { val: batchSize }, offset: { val: skip } },
        }
        const batch = await withRetry(
            () => service.run(query),
            retry
        )

        if (batch && batch.length > 0) {
            yield batch
            skip += batch.length
            hasMore = batch.length > 0 && (!stopWhenPartialPage || batch.length >= batchSize)
        } else {
            hasMore = false
        }
    }
}

module.exports = { entityShapeReadStream, hasDeltaFilter, resolveSourceEntityRef }
