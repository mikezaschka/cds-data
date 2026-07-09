const { fs, path } = global.cds.utils
const { isManagementConfigured } = require('./config-normalizer')

const indexRoot = (pluginDir) => path.join(pluginDir, 'index')

/**
 * Resolve plugin CDS model roots to inject into cds.env.roots.
 *
 * @param {object} options
 * @param {string} options.pluginDir
 * @param {string} options.projectRoot
 * @param {string} [options.srvFolder='srv']
 * @param {Array<{ normalized: ReturnType<import('./config-normalizer').normalizePipelineConfig> }>} options.normalizedConfigs
 * @returns {{ roots: string[], reuseConsole: boolean, warnings: string[] }}
 */
function resolvePluginRoots({
    pluginDir,
    projectRoot,
    srvFolder = 'srv',
    normalizedConfigs,
}) {
    const roots = []
    const warnings = []
    const pushRoot = (root) => {
        if (!roots.includes(root)) roots.push(root)
    }

    const apiImportedInProject = projectImportsPipelineIndex(projectRoot, srvFolder)
    const projectConsoleDir = path.join(projectRoot, 'app', 'pipeline-console')

    const reuseApi = normalizedConfigs.some((c) => c.normalized.reuse?.api)
    const reuseConsole = normalizedConfigs.some((c) => c.normalized.reuse?.console)
    const managementConfigured = normalizedConfigs.some((c) =>
        isManagementConfigured(c.normalized),
    )

    if (reuseApi || reuseConsole) {
        if (apiImportedInProject) {
            warnings.push(
                'cds-data-pipeline: management.reuse.api or management.reuse.console is set but srv/ already imports cds-data-pipeline/index.cds. ' +
                    'Remove the using import or disable management.reuse to avoid duplicate definitions. ' +
                    'See docs/pipeline/guide/feature-activation.md.',
            )
        }
        pushRoot(indexRoot(pluginDir))
    } else if (managementConfigured && !apiImportedInProject) {
        // management block without reuse flags — no auto injection
    }

    if (reuseConsole && fs.existsSync(projectConsoleDir)) {
        warnings.push(
            'cds-data-pipeline: management.reuse.console serves UI from the plugin package, but app/pipeline-console/ already exists. ' +
                'Use management.reuse for zero-config reuse, or cds add pipeline-console for a project-owned UI — not both. ' +
                'See docs/pipeline/guide/feature-activation.md.',
        )
    }

    return { roots, reuseConsole, warnings }
}

function projectImportsPipelineIndex(projectRoot, srvFolder = 'srv') {
    const srvDir = path.join(projectRoot, srvFolder)
    if (!fs.existsSync(srvDir)) return false
    const apiImport = /from\s+['"]cds-data-pipeline\/index\.cds['"]/
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                if (walk(full)) return true
            } else if (entry.name.endsWith('.cds') && apiImport.test(fs.readFileSync(full, 'utf8'))) {
                return true
            }
        }
        return false
    }
    return walk(srvDir)
}

module.exports = {
    resolvePluginRoots,
    projectImportsPipelineIndex,
    indexRoot,
}
