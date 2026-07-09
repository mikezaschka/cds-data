function sourceAdapterRetryOptions(sourceConfig) {
    return {
        maxRetries: sourceConfig.maxRetries || 3,
        baseDelay: sourceConfig.retryDelay || 1000,
        retryOn: (err) => {
            const status = err.status || err.statusCode || err.reason?.status
            return !(typeof status === 'number' && status >= 400 && status < 500)
        },
    }
}

module.exports = { sourceAdapterRetryOptions }
