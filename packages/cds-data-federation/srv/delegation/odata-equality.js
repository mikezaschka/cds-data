const cds = require('@sap/cds')
const { toODataEquality } = require('cds-data-pipeline/srv/lib/mergeStaticWhereIntoSelect')
const { cloneQuery } = require('./clone-query')

/**
 * CXL's null-safe equality `==` has no counterpart in CAP's CQN→OData translator
 * (cqn2odata maps `=`, `!=`, `<>`), so it reaches the remote as a literal `=` and
 * the service rejects the `$filter`. A consumption view's static `where` is the
 * common source: `... where BusinessPartnerCategory == '1'`.
 *
 * Delegate reads therefore rewrite `==` to `=` on the way out, for OData remotes
 * only — CQN-native remotes (hcql, db) handle `==` natively and keep its
 * null-safe semantics.
 */
function isODataRemote(remote, sourceServiceName) {
    const kinds = [
        remote?.kind,
        remote?.options?.kind,
        sourceServiceName ? cds.env?.requires?.[sourceServiceName]?.kind : undefined,
    ]
    return kinds.some(kind => kind === 'odata' || kind === 'odata-v2')
}

function containsCxlEquality(xpr) {
    if (!Array.isArray(xpr)) return false
    return xpr.some(token =>
        token === '=='
        || (token && typeof token === 'object'
            && (containsCxlEquality(token.xpr) || containsCxlEquality(token.args)))
    )
}

/**
 * Returns a query safe to send to `remote`. Clones before rewriting, so neither
 * `req.query` nor the model's static `where` is mutated; returns the original
 * query untouched when there is nothing to rewrite (the common case).
 */
function withODataEquality(remote, query, sourceServiceName) {
    const where = query?.SELECT?.where
    if (!containsCxlEquality(where)) return query
    if (!isODataRemote(remote, sourceServiceName)) return query

    return cloneQuery(query, {
        where: toODataEquality(JSON.parse(JSON.stringify(where))),
    })
}

module.exports = { withODataEquality, isODataRemote, containsCxlEquality }
