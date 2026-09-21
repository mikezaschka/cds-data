'use strict'

/**
 * Answers a READ against a fixed in-memory list the way CAP answers one against
 * a table.
 *
 * An entity with `@cds.persistence.skip` has no table, so CAP applies none of
 * the query: whatever the `on('READ')` handler returns is serialised as is.
 * Returning the whole list therefore ignores `$filter`, `$orderby`, `$top`,
 * `$skip`, `$select` and `$search` without saying so — the value lists behind
 * the Start dialog came back unsorted although the dialog asks for `$orderby`.
 *
 * Deliberately small: comparisons, `and`/`or`/`not`, `in`, and the string
 * functions OData clients send. Anything else throws, so the caller can answer
 * 400 instead of returning an unfiltered list that looks filtered.
 */

class UnsupportedQuery extends Error {}

const COMPARATORS = {
    '=': (a, b) => (b == null ? a == null : a === b),
    '==': (a, b) => (b == null ? a == null : a === b),
    '!=': (a, b) => (b == null ? a != null : a !== b),
    '<>': (a, b) => (b == null ? a != null : a !== b),
    '<': (a, b) => a != null && b != null && a < b,
    '<=': (a, b) => a != null && b != null && a <= b,
    '>': (a, b) => a != null && b != null && a > b,
    '>=': (a, b) => a != null && b != null && a >= b,
}

const FUNCTIONS = {
    contains: (s, t) => typeof s === 'string' && s.includes(t),
    startswith: (s, t) => typeof s === 'string' && s.startsWith(t),
    endswith: (s, t) => typeof s === 'string' && s.endsWith(t),
    tolower: s => (typeof s === 'string' ? s.toLowerCase() : s),
    toupper: s => (typeof s === 'string' ? s.toUpperCase() : s),
}

function operand(token, row) {
    if (token && Array.isArray(token.ref)) {
        if (token.ref.length !== 1) throw new UnsupportedQuery(`path '${token.ref.join('.')}'`)
        return row[token.ref[0]]
    }
    if (token && 'val' in token) return token.val
    if (token && Array.isArray(token.list)) return token.list.map(item => operand(item, row))
    if (token && token.func) {
        const fn = FUNCTIONS[String(token.func).toLowerCase()]
        if (!fn) throw new UnsupportedQuery(`function '${token.func}'`)
        return fn(...(token.args || []).map(arg => operand(arg, row)))
    }
    if (token && Array.isArray(token.xpr)) return evaluate(token.xpr, row)
    throw new UnsupportedQuery(`expression ${JSON.stringify(token)}`)
}

/** Recursive descent over a CQN token list: or < and < not < comparison. */
function evaluate(tokens, row) {
    let pos = 0
    const peek = () => tokens[pos]
    const isWord = (t, word) => typeof t === 'string' && t.toLowerCase() === word

    const primary = () => {
        if (isWord(peek(), 'not')) { pos++; return !primary() }
        const left = tokens[pos++]
        const op = peek()
        if (typeof op === 'string' && COMPARATORS[op]) {
            pos++
            return COMPARATORS[op](operand(left, row), operand(tokens[pos++], row))
        }
        if (isWord(op, 'in') || (isWord(op, 'not') && isWord(tokens[pos + 1], 'in'))) {
            const negate = isWord(op, 'not')
            pos += negate ? 2 : 1
            const found = operand(tokens[pos++], row).includes(operand(left, row))
            return negate ? !found : found
        }
        if (typeof op === 'string' && !isWord(op, 'and') && !isWord(op, 'or')) {
            throw new UnsupportedQuery(`operator '${op}'`)
        }
        return Boolean(operand(left, row))
    }
    const conjunction = () => {
        let value = primary()
        while (isWord(peek(), 'and')) { pos++; value = primary() && value }
        return value
    }
    const disjunction = () => {
        let value = conjunction()
        while (isWord(peek(), 'or')) { pos++; value = conjunction() || value }
        return value
    }

    const result = disjunction()
    if (pos < tokens.length) throw new UnsupportedQuery(`token ${JSON.stringify(tokens[pos])}`)
    return result
}

/** `$search`: a case-insensitive substring match on any String element. */
function matchesSearch(search, row, entity) {
    const terms = (search || [])
        .filter(t => t && 'val' in t)
        .map(t => String(t.val).toLowerCase())
    if (!terms.length) return true
    const strings = Object.entries(entity?.elements || {})
        .filter(([, el]) => el.type === 'cds.String')
        .map(([name]) => String(row[name] ?? '').toLowerCase())
    return terms.every(term => strings.some(s => s.includes(term)))
}

function sortRows(rows, orderBy) {
    return rows
        .map((row, index) => ({ row, index }))
        .sort((a, b) => {
            for (const order of orderBy) {
                const left = operand(order, a.row)
                const right = operand(order, b.row)
                if (left === right) continue
                const cmp = left == null ? -1 : right == null ? 1 : left < right ? -1 : 1
                return String(order.sort).toLowerCase() === 'desc' ? -cmp : cmp
            }
            return a.index - b.index
        })
        .map(item => item.row)
}

function project(rows, columns, entity) {
    if (!Array.isArray(columns) || !columns.length) return rows
    if (columns.some(c => c === '*' || c?.ref?.[0] === '*')) return rows
    const picks = columns.map(column => {
        if (!Array.isArray(column?.ref) || column.ref.length !== 1) {
            throw new UnsupportedQuery(`column ${JSON.stringify(column)}`)
        }
        return { from: column.ref[0], as: column.as || column.ref[0] }
    })
    // Keys always travel, as they do from any CAP-served entity.
    for (const key of Object.keys(entity?.keys || {})) {
        if (!picks.some(p => p.as === key)) picks.unshift({ from: key, as: key })
    }
    return rows.map(row => Object.fromEntries(picks.map(({ from, as }) => [as, row[from]])))
}

/**
 * @param {object[]} source the full list
 * @param {object} req the READ request
 * @returns {object[]} the rows the query asks for, with `$count` when requested
 */
function queryStaticRows(source, req) {
    const select = req.query?.SELECT || {}
    const entity = req.target
    let rows = [...source]

    // A by-key read arrives as params, not as a `where`.
    const params = req.params?.[0]
    if (params !== undefined) {
        const keys = typeof params === 'object' ? params : { [Object.keys(entity?.keys || {})[0]]: params }
        rows = rows.filter(row => Object.entries(keys).every(([k, v]) => row[k] === v))
    }
    if (Array.isArray(select.where) && select.where.length) {
        rows = rows.filter(row => evaluate(select.where, row))
    }
    if (select.search) rows = rows.filter(row => matchesSearch(select.search, row, entity))
    if (Array.isArray(select.orderBy) && select.orderBy.length) rows = sortRows(rows, select.orderBy)

    const total = rows.length
    if (select.limit) {
        const offset = Number(select.limit.offset?.val || 0)
        const count = select.limit.rows?.val
        rows = rows.slice(offset, count == null ? undefined : offset + Number(count))
    }
    rows = project(rows, select.columns, entity)
    if (select.count) rows.$count = total
    return rows
}

module.exports = { queryStaticRows, UnsupportedQuery }
