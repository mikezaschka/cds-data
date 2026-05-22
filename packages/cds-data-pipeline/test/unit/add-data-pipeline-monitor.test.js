/**
 * @jest-environment node
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const cds = require('@sap/cds')
const cdsDk = require('@sap/cds-dk')

/**
 * @returns {import('../../lib/add-data-pipeline-monitor')}
 */
function loadAddPlugin() {
    // Load after Jest sets cwd / roots; path is from repo
    // eslint-disable-next-line import/no-dynamic-require -- test-only
    return require(path.join(__dirname, '../../lib/add-data-pipeline-monitor.js'))
}

describe('add-data-pipeline-monitor', () => {
    let oldCdsRoot, oldDkRoot, tmp

    beforeAll(() => {
        oldCdsRoot = cds.root
        oldDkRoot = cdsDk.root
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-add-'))
        fs.writeFileSync(
            path.join(tmp, 'package.json'),
            JSON.stringify({ name: 'tmp-cdp-app', private: true }, null, 2) + '\n',
        )
        cds.root = tmp
        cdsDk.root = tmp
    })

    afterAll(() => {
        cds.root = oldCdsRoot
        cdsDk.root = oldDkRoot
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
    })

    it('creates server.js with manual mount from cds-data-pipeline', async () => {
        const AddDataPipelineMonitor = loadAddPlugin()
        const p = new AddDataPipelineMonitor()
        await p.run()

        const serverJs = fs.readFileSync(path.join(tmp, 'server.js'), 'utf8')
        expect(serverJs).toContain("require('cds-data-pipeline/lib/mount-pipeline-console')")
        expect(serverJs).toContain('module.exports = cds.server')

        expect(fs.existsSync(path.join(tmp, 'PIPELINE-CONSOLE.md'))).toBe(true)
    })

    it('appends mount require to an existing server.js', async () => {
        fs.writeFileSync(
            path.join(tmp, 'server.js'),
            "const cds = require('@sap/cds')\nmodule.exports = cds.server\n",
        )

        const AddDataPipelineMonitor = loadAddPlugin()
        await new AddDataPipelineMonitor().run()

        const serverJs = fs.readFileSync(path.join(tmp, 'server.js'), 'utf8')
        expect(serverJs).toContain("require('cds-data-pipeline/lib/mount-pipeline-console')")
        expect(serverJs.match(/mount-pipeline-console/g)).toHaveLength(1)
    })
})
