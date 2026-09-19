const cds = require('@sap/cds')

/**
 * `cds.ql.clone()` returns a *prototype-linked* clone: the source clauses
 * (`from`, `columns`, `where`, ...) live on the prototype, so the clone's
 * `SELECT` has **no own enumerable properties**.
 *
 * Property access still resolves them, which is why CAP's CQN→OData translator
 * is unaffected. Anything that iterates own keys is not: `JSON.stringify` — and
 * therefore every wire protocol that ships CQN as JSON, HCQL above all — sees
 * only the clauses assigned *after* cloning. A page query built that way
 * reaches the remote as `{ limit, count }`: no target, no filter, no column
 * restriction. The remote answers with unfiltered rows, the paging loop never
 * advances, and rows come back duplicated.
 *
 * `cloneQuery` therefore materialises the inherited clauses as own properties
 * (`for...in` walks the prototype chain) and applies `overrides` on top. The
 * result is a standalone query: serialising it is lossless, and mutating its
 * clauses cannot reach the caller's query — `req.query` included.
 */
function cloneQuery(query, overrides = {}) {
    const clone = cds.ql.clone(query)
    const select = query?.SELECT
    if (!select) return clone

    const clauses = {}
    for (const key in select) clauses[key] = select[key]
    clone.SELECT = { ...clauses, ...overrides }
    return clone
}

module.exports = { cloneQuery }
