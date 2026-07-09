// @vitest-environment node
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const { resolvePluginRoots, projectImportsPipelineIndex } = require('../../lib/plugin-roots')

describe('plugin-roots', () => {
    let tmp

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-roots-'))
        fs.mkdirSync(path.join(tmp, 'srv'), { recursive: true })
    })

    afterEach(() => {
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
    })

    it('injects index root when reuse.api is set', () => {
        const pluginDir = path.join(__dirname, '../..')
        const { roots, reuseConsole, warnings } = resolvePluginRoots({
            pluginDir,
            projectRoot: tmp,
            normalizedConfigs: [
                {
                    normalized: {
                        reuse: { api: true, console: false },
                    },
                },
            ],
        })

        expect(roots).toContain(path.join(pluginDir, 'index'))
        expect(reuseConsole).toBe(false)
        expect(warnings).toHaveLength(0)
    })

    it('warns when reuse.api and manual index import both exist', () => {
        fs.writeFileSync(
            path.join(tmp, 'srv', 'pipeline-management.cds'),
            "using from 'cds-data-pipeline/index.cds';\n",
        )

        const { warnings } = resolvePluginRoots({
            pluginDir: path.join(__dirname, '../..'),
            projectRoot: tmp,
            normalizedConfigs: [
                {
                    normalized: {
                        reuse: { api: true, console: false },
                    },
                },
            ],
        })

        expect(warnings.some((w) => w.includes('already imports'))).toBe(true)
    })

    it('detects manual index.cds import in srv/', () => {
        fs.mkdirSync(path.join(tmp, 'srv', 'nested'), { recursive: true })
        fs.writeFileSync(
            path.join(tmp, 'srv', 'nested', 'pipeline.cds'),
            "using from 'cds-data-pipeline/index.cds';\n",
        )

        expect(projectImportsPipelineIndex(tmp)).toBe(true)
    })
})
