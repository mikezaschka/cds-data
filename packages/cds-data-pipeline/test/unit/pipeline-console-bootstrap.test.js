// @vitest-environment node
const path = require('node:path')

const {
    DEFAULT_UI5_URL,
    isValidUi5Url,
    resolveUi5Url,
    renderIndexHtml,
    createIndexHandler,
} = require('../../lib/pipeline-console-bootstrap')

describe('pipeline-console-bootstrap', () => {
    it('uses the pinned UI5 runtime by default', () => {
        expect(resolveUi5Url()).toEqual({ url: DEFAULT_UI5_URL, warnings: [] })
        expect(DEFAULT_UI5_URL).toContain('/1.150.0/')
    })

    it('accepts hosted and same-origin runtime URLs', () => {
        expect(isValidUi5Url('https://ui5.example.test/resources/sap-ui-core.js')).toBe(true)
        expect(isValidUi5Url('/ui5/resources/sap-ui-core.js')).toBe(true)

        const result = resolveUi5Url([
            {
                name: 'data-pipeline',
                normalized: {
                    management: { ui5Url: '/ui5/resources/sap-ui-core.js' },
                },
            },
        ])
        expect(result).toEqual({ url: '/ui5/resources/sap-ui-core.js', warnings: [] })
    })

    it('rejects unsafe runtime URLs', () => {
        for (const value of [
            '',
            'relative/ui5.js',
            'javascript:alert(1)',
            'https://bad.test/a"b',
            '//evil.example/ui5.js',
            '/\\evil.example/ui5.js',
        ]) {
            expect(isValidUi5Url(value)).toBe(false)
        }

        const result = resolveUi5Url([
            {
                name: 'data-pipeline',
                normalized: { management: { ui5Url: 'javascript:alert(1)' } },
            },
        ])
        expect(result.url).toBe(DEFAULT_UI5_URL)
        expect(result.warnings).toHaveLength(1)
    })

    it('replaces the bootstrap source in index HTML', () => {
        const html =
            '<script data-sap-ui-async="true" id="sap-ui-bootstrap" src="old.js"></script>'
        expect(renderIndexHtml(html, '/ui5/sap-ui-core.js')).toContain(
            'src="/ui5/sap-ui-core.js"',
        )
    })

    it('serves a rendered built index page', () => {
        const handler = createIndexHandler(
            path.join(__dirname, '../../app/pipeline-console-src/webapp'),
            '/ui5/sap-ui-core.js',
        )
        const res = {
            type: vi.fn().mockReturnThis(),
            send: vi.fn(),
        }
        const next = vi.fn()

        handler({}, res, next)

        expect(res.type).toHaveBeenCalledWith('html')
        expect(res.send.mock.calls[0][0]).toContain('src="/ui5/sap-ui-core.js"')
        expect(next).not.toHaveBeenCalled()
    })
})

describe('mountPipelineConsole', () => {

    /**
     * Mirrors @sap/cds/server.js: `serve(endpoint).from(...)` serves the folder
     * *and* registers the endpoint in `_app_links`, which is what the index page
     * lists. Identical in 9.0.2, 9.9.3 and 10.1.1.
     */
    const fakeApp = () => {
        const app = { mounts: [], _app_links: undefined }
        app.use = (path, handler) => app.mounts.push({ path, handler })
        app.serve = endpoint => ({
            from: (pkg, folder) => {
                app.mounts.push({ path: endpoint, static: `${pkg}/${folder}` })
                if (!endpoint.endsWith('/webapp')) (app._app_links ??= []).push(endpoint)
            },
        })
        return app
    }

    const options = { consolePath: '/nonexistent/console', ui5Url: 'https://ui5.sap.com/1.150.0/resources/sap-ui-core.js' }

    it('lists the console exactly once on the index page', () => {
        const { mountPipelineConsole } = require('../../lib/pipeline-console-bootstrap')
        const app = fakeApp()
        expect(mountPipelineConsole(app, options)).toBe(true)
        expect(app._app_links.filter(l => l === '/pipeline-console')).toHaveLength(1)
    })

    it('serves the built app and an index handler under the same path', () => {
        const { mountPipelineConsole } = require('../../lib/pipeline-console-bootstrap')
        const app = fakeApp()
        mountPipelineConsole(app, options)
        const paths = app.mounts.map(m => m.path)
        expect(paths).toEqual(['/pipeline-console', '/pipeline-console'])
        expect(app.mounts.find(m => m.static)?.static).toBe('cds-data-pipeline/app/pipeline-console')
    })

    it('reports when the app cannot serve static folders', () => {
        const { mountPipelineConsole } = require('../../lib/pipeline-console-bootstrap')
        expect(mountPipelineConsole({ use: () => {} }, options)).toBe(false)
        expect(mountPipelineConsole(undefined, options)).toBe(false)
    })
})
