/**
 * Rewrites CXL null-safe equality `==` to `=` (recursively, in place).
 * CAP's CQN→OData translator (cqn2odata) maps `=`, `!=`, `<>` but not `==`,
 * so a projection `where x == 'y'` would otherwise produce an invalid `$filter`.
 */
function toODataEquality(xpr) {
    if (!Array.isArray(xpr)) return xpr
    for (let i = 0; i < xpr.length; i++) {
        const token = xpr[i]
        if (token === '==') xpr[i] = '='
        else if (token && typeof token === 'object') {
            if (Array.isArray(token.xpr)) toODataEquality(token.xpr)
            if (Array.isArray(token.args)) toODataEquality(token.args)
        }
    }
    return xpr
}

/**
 * AND-combines a CSN-style projection `where` array into a SELECT statement.
 *
 * @param {object} selectStatement - CAP `SELECT.from(...)` statement (has `.SELECT`)
 * @param {object[]|null|undefined} staticWhere - CQN WHERE xpr array from CSN
 * @param {object} [options]
 * @param {boolean} [options.odata=false] - Source is an OData remote; rewrite `==` to `=`.
 */
function mergeStaticWhereIntoSelect(selectStatement, staticWhere, { odata = false } = {}) {
    if (!staticWhere || !Array.isArray(staticWhere) || staticWhere.length === 0) return
    if (!selectStatement || !selectStatement.SELECT) return
    const existing = selectStatement.SELECT.where
    // OData datetime-fields delta uses a string `$filter` fragment; skip AND-combining CSN `where` arrays.
    if (existing && typeof existing === 'string') return
    const sw = JSON.parse(JSON.stringify(staticWhere))
    if (odata) toODataEquality(sw)
    if (existing) {
        selectStatement.SELECT.where = [...existing, 'and', ...sw]
    } else {
        selectStatement.SELECT.where = sw
    }
}

module.exports = { mergeStaticWhereIntoSelect, toODataEquality }
