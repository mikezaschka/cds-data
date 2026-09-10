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
