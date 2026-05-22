/**
 * Mount the pre-built Pipeline Console from this reuse package.
 *
 * Follows CAP reuse-and-compose: {@link https://cap.cloud.sap/docs/guides/integration/reuse-and-compose#reuse-uis}
 *
 * Requires `module.exports = cds.server` so `@sap/cds/server` patches `express.application.serve`.
 *
 * @example
 *   const cds = require('@sap/cds')
 *   require('cds-data-pipeline/lib/mount-pipeline-console')
 *   module.exports = cds.server
 *
 * @example Custom mount path
 *   const { registerMountPipelineConsole } = require('cds-data-pipeline/lib/mount-pipeline-console')
 *   registerMountPipelineConsole('/admin/pipelines')
 *   module.exports = cds.server
 */
const cds = global.cds
if (!cds) {
    throw new Error(
        '[cds-data-pipeline] global.cds is unset — require @sap/cds before mounting Pipeline Console',
    )
}

const PACKAGE = 'cds-data-pipeline'
const UI_FOLDER = 'app/pipeline-console'
const DEFAULT_MOUNT = '/pipeline-console'

function mountPipelineConsole(app, mountPath = DEFAULT_MOUNT) {
    if (typeof app.serve !== 'function') {
        throw new Error(
            '[cds-data-pipeline] app.serve is unavailable — export cds.server from server.js before bootstrap',
        )
    }
    app.serve(mountPath).from(PACKAGE, UI_FOLDER)
}

function registerMountPipelineConsole(mountPath = DEFAULT_MOUNT) {
    cds.once('bootstrap', (app) => mountPipelineConsole(app, mountPath))
}

registerMountPipelineConsole()

module.exports = {
    mountPipelineConsole,
    registerMountPipelineConsole,
    DEFAULT_MOUNT,
    PACKAGE,
    UI_FOLDER,
}
