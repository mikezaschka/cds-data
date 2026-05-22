'use strict'

/**
 * The CAP runtime singleton (`@sap/cds` sets `global.cds` on first load).
 *
 * Never `require('@sap/cds')` from pipeline modules: npm workspaces / `file:`
 * installs can nest a second `@sap/cds` under this package, with no `cds.db`
 * and a separate `EventEmitter` (broken `served` listeners, failed queries).
 */
if (!global.cds) {
    throw new Error(
        '[cds-data-pipeline] global.cds is unset — load @sap/cds before any pipeline module',
    )
}
module.exports = global.cds
