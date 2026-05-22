const cds = require('@sap/cds')

/**
 * Resolve CAP tenant id from an incoming request (mocked auth, MTX JWT, or cds.context).
 */
function resolveRequestTenant(req) {
    const fromUser = req?.user?.tenant ?? req?.user?.attr?.tenant
    if (fromUser != null && String(fromUser) !== '') return String(fromUser)

    const uid = req?.user?.id ?? req?.user?._?.id ?? req?.user?.name
    const users = cds.env?.requires?.auth?.users
    if (uid && users) {
        const configured = users[uid]
        const fromConfigured =
            configured?.tenant ??
            configured?.attr?.tenant
        if (fromConfigured != null && String(fromConfigured) !== '') {
            return String(fromConfigured)
        }
    }

    const fromCtx =
        cds.context?.tenant ??
        cds.context?.user?.tenant
    if (fromCtx != null && String(fromCtx) !== '') return String(fromCtx)

    return ''
}

module.exports = { resolveRequestTenant }
