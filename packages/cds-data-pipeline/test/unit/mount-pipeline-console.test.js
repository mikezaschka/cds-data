/**
 * @jest-environment node
 */
const path = require('node:path')
const express = require('express')

const cds = require('@sap/cds')

describe('mount-pipeline-console', () => {
    const {
        mountPipelineConsole,
        DEFAULT_MOUNT,
        PACKAGE,
        UI_FOLDER,
    } = require('../../lib/mount-pipeline-console')

    beforeAll(() => {
        require('@sap/cds/server')
    })

    it('resolves the pre-built UI folder in the published package layout', () => {
        const pkgJson = require.resolve(`${PACKAGE}/package.json`, { paths: [cds.root] })
        const uiRoot = path.join(path.dirname(pkgJson), UI_FOLDER)
        expect(require('node:fs').existsSync(path.join(uiRoot, 'index.html'))).toBe(true)
    })

    it('mounts static files at the given endpoint', () => {
        const app = express()
        mountPipelineConsole(app, '/test-console')

        const layer = app._router.stack.find(
            (entry) => entry.route?.path === '/test-console' || entry.regexp?.test?.('/test-console/'),
        )
        expect(layer).toBeDefined()
    })

    it('registers default bootstrap mount once when required', () => {
        const listeners = cds.listeners('bootstrap').length
        require('../../lib/mount-pipeline-console')
        expect(cds.listeners('bootstrap').length).toBeGreaterThanOrEqual(listeners)
        expect(DEFAULT_MOUNT).toBe('/pipeline-console')
    })
})
