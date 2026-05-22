const BaseSourceAdapter = require('./BaseSourceAdapter')
const { withRetry } = require('../lib/retry')

class RestAdapter extends BaseSourceAdapter {
    constructor(service, config) {
        super(service, config)
    }

    async *readStream(tracker) {
        const rest = this.config.rest || {}
        const sourceConfig = this.config.source
        const pagination = rest.pagination || {}
        const batchSize = pagination.pageSize || sourceConfig.batchSize || 1000

        let page = 1
        let cursor = null
        let hasMore = true

        while (hasMore) {
            if (sourceConfig.delay) {
                await new Promise(r => setTimeout(r, sourceConfig.delay))
            }

            const params = this._buildParams({ page, cursor, tracker, batchSize })
            const pathWithParams = this._buildUrl(rest.path, params)

            const response = await withRetry(
                () => this.service.send({
                    method: rest.method || 'GET',
                    path: pathWithParams,
                    headers: rest.headers || {},
                }),
                {
                    maxRetries: sourceConfig.maxRetries || 3,
                    baseDelay: sourceConfig.retryDelay || 1000,
                    retryOn: (err) => {
                        const status = err.status || err.statusCode || err.reason?.status
                        return !(typeof status === 'number' && status >= 400 && status < 500)
                    },
                }
            )

            const data = rest.dataPath
                ? this._extractByPath(response, rest.dataPath)
                : (Array.isArray(response) ? response : [])

            if (!data || data.length === 0) {
                hasMore = false
                break
            }

            yield data

            switch (pagination.type) {
                case 'cursor':
                    cursor = this._extractByPath(response, pagination.cursorPath)
                    hasMore = !!cursor
                    break
                case 'offset':
                case 'page':
                    page++
                    hasMore = data.length >= batchSize
                    break
                default:
                    hasMore = false
            }
        }
    }

    _buildParams({ page, cursor, tracker, batchSize }) {
        const params = {}
        const rest = this.config.rest || {}
        const pagination = rest.pagination || {}

        switch (pagination.type) {
            case 'cursor':
                if (cursor) params[pagination.cursorParam || 'cursor'] = cursor
                break
            case 'offset':
                params[pagination.limitParam || 'limit'] = batchSize
                params[pagination.offsetParam || 'offset'] = (page - 1) * batchSize
                break
            case 'page':
                params[pagination.pageParam || 'page'] = page
                params[pagination.limitParam || 'limit'] = batchSize
                break
        }

        if (tracker.lastSync && rest.deltaParam) {
            params[rest.deltaParam] = tracker.lastSync
        }

        return params
    }

    _buildUrl(basePath, params) {
        const qs = Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&')
        return qs ? `${basePath}?${qs}` : basePath
    }

    _extractByPath(obj, path) {
        if (!path || !obj) return obj
        return path.split('.').reduce((o, key) => o?.[key], obj)
    }
}

module.exports = RestAdapter
