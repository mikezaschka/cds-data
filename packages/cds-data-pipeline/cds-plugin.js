/**
 * cds-data-pipeline — CAP plugin entry (optional runtime hooks).
 *
 * Service wiring follows the same pattern as other CAP plugins (e.g. `@cap-js/sqlite`):
 * `package.json` → `cds.requires.DataPipelineService.impl` so
 * `cds.connect.to('DataPipelineService')` uses the framework factory and caches
 * the instance on `cds.services` (see CAPire
 * [CDS Plugin Packages](https://cap.cloud.sap/docs/node.js/cds-plugins) and
 * [Connecting to Required Services](https://cap.cloud.sap/docs/node.js/cds-connect)).
 *
 * Do **not** `require('@sap/cds')` here: npm workspaces / `file:` installs can
 * resolve a duplicate `@sap/cds` under this package, breaking `global.cds`
 * (listeners, `cds.db`, …). Use `global.cds` only when this file needs the facade.
 */
const cds = global.cds
if (!cds) {
    throw new Error(
        '[cds-data-pipeline] global.cds is unset — @sap/cds must load before this plugin',
    )
}

if (process.env.CDS_PIPELINE_TEST_CONSUMER === 'true') {
    try {
        require('./test/fixtures/consumer/register-fixture-pipelines.js')
    } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') throw e
    }
    if (process.env.CDS_PIPELINE_TEST_MESSAGING === 'true') {
        try {
            require('./test/fixtures/consumer/messaging-pipeline-bridge.js')
        } catch (e) {
            if (e.code !== 'MODULE_NOT_FOUND') throw e
        }
    }
}

// `cds add data-pipeline-monitor` — `global.cds.add` only exists for `cds add` (cds-dk); skip otherwise.
if (global.cds.add?.register) {
    try {
        global.cds.add.register('data-pipeline-monitor', require('./lib/add-data-pipeline-monitor'))
    } catch (e) {
        if (e?.code !== 'MODULE_NOT_FOUND') throw e
    }
}
