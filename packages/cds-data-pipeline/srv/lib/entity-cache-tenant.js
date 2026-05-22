const { AsyncLocalStorage } = require('async_hooks')

/** Per-run tenant override for entity-cache pipeline targets (ADR 0010). */
const _store = new AsyncLocalStorage()

function runWithEntityCacheTenant(tenant, fn) {
    const tid = tenant == null || String(tenant) === '' ? undefined : String(tenant)
    return _store.run(tid, fn)
}

function currentEntityCacheTenant() {
    return _store.getStore()
}

module.exports = {
    runWithEntityCacheTenant,
    currentEntityCacheTenant,
}
