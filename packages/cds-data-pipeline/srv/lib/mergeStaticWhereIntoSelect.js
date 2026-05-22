/**
 * AND-combines a CSN-style projection `where` array into a SELECT statement.
 *
 * @param {object} selectStatement - CAP `SELECT.from(...)` statement (has `.SELECT`)
 * @param {object[]|null|undefined} staticWhere - CQN WHERE xpr array from CSN
 */
function mergeStaticWhereIntoSelect(selectStatement, staticWhere) {
    if (!staticWhere || !Array.isArray(staticWhere) || staticWhere.length === 0) return
    if (!selectStatement || !selectStatement.SELECT) return
    const existing = selectStatement.SELECT.where
    // OData datetime-fields delta uses a string `$filter` fragment; skip AND-combining CSN `where` arrays.
    if (existing && typeof existing === 'string') return
    const sw = JSON.parse(JSON.stringify(staticWhere))
    if (existing) {
        selectStatement.SELECT.where = [...existing, 'and', ...sw]
    } else {
        selectStatement.SELECT.where = sw
    }
}

module.exports = { mergeStaticWhereIntoSelect }
