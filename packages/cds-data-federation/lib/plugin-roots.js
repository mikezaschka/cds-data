const cds = require('@sap/cds')
const { fs, path } = cds.utils

const managementRoot = (pluginDir) => path.join(pluginDir, 'management')
const metricsRoot = (pluginDir) => path.join(pluginDir, 'metrics')
const managementMetricsRoot = (pluginDir) => path.join(pluginDir, 'management-metrics')

/**
 * Decide whether to inject the management model into `cds.env.roots`.
 *
 * Mirrors `cds-data-pipeline/lib/plugin-roots.js`: zero-config reuse from the
 * plugin package, or a project-owned import, never both.
 *
 * @param {object} options
 * @param {string} options.pluginDir
 * @param {string} options.projectRoot
 * @param {string} [options.srvFolder='srv']
 * @returns {{ roots: string[], reuseConsole: boolean, warnings: string[] }}
 */
function resolvePluginRoots({ pluginDir, projectRoot, srvFolder = 'srv' }) {
    const roots = []
    const warnings = []

    const management = cds.env?.requires?.['data-federation']?.management || {}
    const reuseApi = management.reuse?.api === true
    const reuseConsole = management.reuse?.console === true
    const importedInProject = projectImportsManagement(projectRoot, srvFolder)

    if (reuseApi || reuseConsole) {
        if (importedInProject) {
            warnings.push(
                'cds-data-federation: management.reuse is set but srv/ already imports ' +
                "cds-data-federation/management.cds. Remove the using import or disable " +
                'management.reuse to avoid a duplicate definition of FederationManagementService.',
            )
        } else {
            roots.push(managementRoot(pluginDir))
        }
    }

    // ADR 0019 — the metrics table exists only when metrics are switched on, so
    // an app that never enables them deploys no table.
    const metricsEnabled = cds.env?.requires?.['data-federation']?.metrics?.enabled === true
    if (metricsEnabled) {
        roots.push(metricsRoot(pluginDir))
        // The projection needs both models, so it loads only when both are on.
        if (roots.includes(managementRoot(pluginDir))) {
            roots.push(managementMetricsRoot(pluginDir))
        }
    }

    return { roots, reuseConsole, warnings }
}

function projectImportsManagement(projectRoot, srvFolder = 'srv') {
    const srvDir = path.join(projectRoot, srvFolder)
    if (!fs.existsSync(srvDir)) return false
    const importRe = /from\s+['"]cds-data-federation\/management\.cds['"]/
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                if (walk(full)) return true
            } else if (entry.name.endsWith('.cds') && importRe.test(fs.readFileSync(full, 'utf8'))) {
                return true
            }
        }
        return false
    }
    return walk(srvDir)
}

module.exports = { resolvePluginRoots, projectImportsManagement, managementRoot, metricsRoot, managementMetricsRoot }
