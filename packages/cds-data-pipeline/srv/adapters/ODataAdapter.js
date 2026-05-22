const cds = require('../runtime-cds')
const BaseSourceAdapter = require('./BaseSourceAdapter')
const { withRetry } = require('../lib/retry')
const { mergeStaticWhereIntoSelect } = require('../lib/mergeStaticWhereIntoSelect')

class ODataAdapter extends BaseSourceAdapter {
    constructor(service, config) {
        super(service, config)
    }

    async *readStream(tracker) {
        const sourceConfig = this.config.source
        const viewMapping = this.config.viewMapping || { isWildcard: true, projectedColumns: [] }
        const delta = this.config.delta || {}

        let baseQuery = SELECT.from(sourceConfig.entity)

        if (!viewMapping.isWildcard && viewMapping.projectedColumns.length > 0) {
            baseQuery = baseQuery.columns(viewMapping.projectedColumns)
        }

        const deltaFilter = this._buildDeltaFilter(delta, tracker)
        const hasDelta = deltaFilter && (
            (typeof deltaFilter === 'string' && deltaFilter.length > 0) ||
            (typeof deltaFilter === 'object' && Object.keys(deltaFilter).length > 0)
        )
        if (hasDelta) {
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

            const query = cds.ql.clone(baseQuery).limit(batchSize, skip)
            const batch = await withRetry(
                () => this.service.run(query),
                {
                    maxRetries: sourceConfig.maxRetries || 3,
                    baseDelay: sourceConfig.retryDelay || 1000,
                    retryOn: (err) => {
                        const status = err.status || err.statusCode || err.reason?.status
                        return !(typeof status === 'number' && status >= 400 && status < 500)
                    },
                }
            )

            if (batch.length > 0) {
                yield batch
                skip += batch.length
                hasMore = true
            } else {
                hasMore = false
            }
        }
    }

    _buildDeltaFilter(delta, tracker) {
        const { mode = 'timestamp', field = 'modifiedAt' } = delta

        // Always read the full remote entity on every run — used by federation entity-cache
        // pipelines that scope writes per-tenant rows and reuse the OData adapter without
        // meaningful delta slicing (tracker lastSync is still updated for bookkeeping).
        if (mode === 'none') return {}

        if (!tracker.lastSync) return {}

        switch (mode) {
            case 'timestamp': {
                let timestamp = new Date(tracker.lastSync).toISOString()
                if (this.service.options?.kind === 'odata-v2') {
                    timestamp = timestamp.slice(0, -1)
                }
                return { [field]: { '>': timestamp } }
            }
            case 'key':
                if (!tracker.lastKey) return {}
                return { [field]: { '>': tracker.lastKey } }

            case 'datetime-fields': {
                const { dateField, timeField } = delta
                if (!dateField || !timeField) {
                    this.LOG.warn('datetime-fields delta mode requires dateField and timeField')
                    return {}
                }
                const lastSyncDate = new Date(tracker.lastSync)
                const dateStr = lastSyncDate.toISOString().split('T')[0]
                const timeStr = lastSyncDate.toTimeString().split(' ')[0]
                return `(${dateField} gt '${dateStr}' or (${dateField} eq '${dateStr}' and ${timeField} gt '${timeStr}'))`
            }
            default:
                return {}
        }
    }
}

module.exports = ODataAdapter
