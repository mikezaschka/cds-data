/**
 * cds-data-pipeline — CAP plugin entry.
 *
 * Service wiring: `impl: "cds-data-pipeline"` resolves to this file's export
 * (`DataPipelineService`), matching the cds-caching plugin pattern.
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

const LOG = cds.log('cds-data-pipeline')
const { path, fs } = cds.utils
const { getPipelineRequiresEntries } = require('./lib/config-normalizer')
const { resolvePluginRoots } = require('./lib/plugin-roots')

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

const pipelineEntries = getPipelineRequiresEntries(cds.env.requires ?? {})
const { roots, reuseConsole, warnings } = resolvePluginRoots({
    pluginDir: __dirname,
    projectRoot: cds.root,
    srvFolder: cds.env.folders?.srv || 'srv',
    normalizedConfigs: pipelineEntries,
})
for (const root of roots) {
    if (!cds.env.roots.includes(root)) cds.env.roots.push(root)
}
for (const message of warnings) LOG.warn(message)

if (reuseConsole) {
    const consolePath = path.join(__dirname, 'app', 'pipeline-console')
    const consoleProbe = path.join(consolePath, 'index.html')
    if (!fs.existsSync(consoleProbe)) {
        LOG.warn(
            'cds-data-pipeline Pipeline Console static resources are incomplete (missing index.html). ' +
                'Run "npm run build:pipeline-console" in the cds-data-pipeline package before using management.reuse.console.',
        )
    }
    cds.once('bootstrap', (app) => {
        if (typeof app.serve !== 'function') {
            LOG.warn(
                'cds-data-pipeline: app.serve is unavailable — export cds.server from server.js to mount Pipeline Console',
            )
            return
        }
        app.serve('/pipeline-console').from('cds-data-pipeline', 'app/pipeline-console')
        ;(app._app_links ??= []).push('/pipeline-console')
        LOG.info('Serving Pipeline Console at /pipeline-console')
    })
}

if (global.cds.add?.register) {
    try {
        global.cds.add.register('pipeline-console', require('./lib/add-pipeline-console'))
    } catch (e) {
        if (e?.code !== 'MODULE_NOT_FOUND') throw e
    }
}

module.exports = require('./srv/DataPipelineService')
