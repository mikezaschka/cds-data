// @vitest-environment node
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const cds = require('@sap/cds')
const cdsDk = require('@sap/cds-dk')

function loadAddPlugin() {
    return require(path.join(__dirname, '../../lib/add-pipeline-console.js'))
}

describe('add-pipeline-console', () => {
    let oldCdsRoot, oldDkRoot, tmp

    beforeAll(() => {
        oldCdsRoot = cds.root
        oldDkRoot = cdsDk.root
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-add-console-'))
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

    it('scaffolds project-owned console and management CDS import', async () => {
        const AddPipelineConsole = loadAddPlugin()
        await new AddPipelineConsole().run()

        expect(fs.existsSync(path.join(tmp, 'app', 'pipeline-console', 'webapp', 'index.html'))).toBe(
            true,
        )
        expect(fs.existsSync(path.join(tmp, 'app', 'pipeline-console', 'ui5.yaml'))).toBe(true)
        expect(fs.existsSync(path.join(tmp, 'srv', 'pipeline-management.cds'))).toBe(true)
        expect(fs.readFileSync(path.join(tmp, 'srv', 'pipeline-management.cds'), 'utf8')).toContain(
            "using from 'cds-data-pipeline/index.cds'",
        )
        expect(fs.existsSync(path.join(tmp, 'server.js'))).toBe(false)
    })

    it('does not overwrite existing pipeline-management.cds', async () => {
        fs.mkdirSync(path.join(tmp, 'srv'), { recursive: true })
        fs.writeFileSync(path.join(tmp, 'srv', 'pipeline-management.cds'), '// existing\n')

        const AddPipelineConsole = loadAddPlugin()
        await new AddPipelineConsole().run()

        expect(fs.readFileSync(path.join(tmp, 'srv', 'pipeline-management.cds'), 'utf8')).toBe(
            '// existing\n',
        )
    })
})
