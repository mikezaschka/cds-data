const cds = require('../runtime-cds')
const { withRetry } = require('./retry')

const LOG = cds.log('cds-data-pipeline')

const CONNECTION_CODES = new Set([
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'SQLITE_BUSY',
    'SQLITE_LOCKED',
])

/**
 * True when `err` (or a nested cause) looks like a transient DB / connection
 * failure worth retrying at registration time (tracker INSERT/UPDATE).
 *
 * Retries HANA 1034 (max external connections), SQLite busy/locked, and
 * common connection resets/timeouts. Does not retry validation, 4xx, or
 * permanent configuration errors.
 *
 * @param {Error|object} err
 * @returns {boolean}
 */
function isTransientDbError(err) {
    if (!err || typeof err !== 'object') return false

    let current = err
    for (let depth = 0; depth < 3 && current; depth++) {
        if (_matchesTransient(current)) return true
        current = current.cause || current.inner || current.originalError || null
    }
    return false
}

function _matchesTransient(err) {
    const code = err.code
    if (code === 1034 || code === '1034') return true
    if (typeof code === 'string' && CONNECTION_CODES.has(code)) return true

    const msg = String(err.message || '')
    if (/HANA\s*1034/i.test(msg)) return true
    if (/exceed maximum number of external connections/i.test(msg)) return true
    if (/SQLITE_BUSY|SQLITE_LOCKED/i.test(msg)) return true
    if (/acquireTimeout|timeout.*pool|pool.*timeout/i.test(msg)) return true
    if (/ECONNRESET|ETIMEDOUT|ECONNREFUSED/i.test(msg)) return true

    const status = err.status || err.statusCode
    if (typeof status === 'number' && status >= 400 && status < 500) return false

    return false
}

/**
 * Retry wrapper for registration-time tracker I/O (bounded backoff).
 * Permanent errors fail immediately; after the budget is exhausted the
 * last error is rethrown (fail loud — never silent boot).
 *
 * @param {Function} fn
 * @param {object} [options] - overrides for withRetry (e.g. baseDelay in tests)
 * @returns {Promise<*>}
 */
function withTransientDbRetry(fn, options = {}) {
    const maxRetries = options.maxRetries === undefined ? 3 : options.maxRetries
    return withRetry(fn, {
        baseDelay: 1000,
        maxDelay: 30000,
        onRetry: (err, attempt) => {
            LOG.warn(
                `Transient DB error during pipeline registration (retry ${attempt}/${maxRetries}): ${err.message}`,
            )
        },
        ...options,
        maxRetries,
        retryOn: options.retryOn || isTransientDbError,
    })
}

module.exports = { isTransientDbError, withTransientDbRetry }
