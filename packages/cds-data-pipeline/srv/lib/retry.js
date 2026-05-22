const cds = require('../runtime-cds')
const LOG = cds.log('cds-data-pipeline')

/**
 * Wraps an async function with exponential backoff retry logic.
 *
 * @param {Function} fn - Async function to execute
 * @param {object} [options] - Retry configuration
 * @param {number} [options.maxRetries=3] - Maximum number of retries (0 = no retries)
 * @param {number} [options.baseDelay=1000] - Base delay in ms before first retry
 * @param {number} [options.maxDelay=30000] - Maximum delay in ms between retries
 * @param {Function} [options.onRetry] - Callback(error, attempt) for logging/monitoring
 * @param {Function} [options.retryOn] - Predicate(error) => boolean; if false, don't retry
 * @returns {Promise<*>} Result of fn()
 */
async function withRetry(fn, options = {}) {
    const {
        maxRetries = 3,
        baseDelay = 1000,
        maxDelay = 30000,
        onRetry,
        retryOn
    } = options

    let lastError
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn()
        } catch (err) {
            lastError = err

            // Check if we should retry
            if (attempt >= maxRetries) break
            if (retryOn && !retryOn(err)) break

            // Calculate delay with jitter: baseDelay * 2^attempt * random(0.5, 1.5)
            const exponentialDelay = baseDelay * Math.pow(2, attempt)
            const jitter = 0.5 + Math.random()
            const delay = Math.min(exponentialDelay * jitter, maxDelay)

            if (onRetry) {
                onRetry(err, attempt + 1)
            } else {
                LOG.warn(`Retry ${attempt + 1}/${maxRetries}: ${err.message}`)
            }

            await new Promise(resolve => setTimeout(resolve, delay))
        }
    }

    throw lastError
}

module.exports = { withRetry }
