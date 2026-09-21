const {
    DEFAULT_UI5_VERSION,
    isValidUi5Url,
    resolveUi5Url,
    renderIndexHtml,
    mountFederationConsole,
    requireAuthenticatedUser,
    redirectToDirectory,
} = require('../../lib/console-bootstrap')

/**
 * Serving and guarding the Federation Console — ADR 0017 §2.
 */
describe('federation console bootstrap', () => {

    const fakeApp = () => {
        const app = { mounts: [], _app_links: undefined }
        app.use = (path, ...handlers) => app.mounts.push({ path, handlers })
        app.serve = endpoint => ({
            from: (pkg, folder) => {
                app.mounts.push({ path: endpoint, static: `${pkg}/${folder}` })
                ;(app._app_links ??= []).push(endpoint)
            },
        })
        return app
    }
    const options = { consolePath: '/nonexistent', ui5Url: 'https://ui5.sap.com/1.148.10/resources/sap-ui-core.js' }

    it('defaults to the active long-term maintenance release', () => {
        // Not the newest feature release: a page hosts one UI5 core, so the
        // three consoles in the suite can only converge on an LTS.
        expect(DEFAULT_UI5_VERSION).toBe('1.148.10')
        expect(resolveUi5Url({}).url).toContain('1.148.10')
    })

    it('accepts an http url or an absolute path, rejects anything injectable', () => {
        expect(isValidUi5Url('https://ui5.sap.com/1.148.10/resources/sap-ui-core.js')).toBe(true)
        expect(isValidUi5Url('/local/sap-ui-core.js')).toBe(true)
        expect(isValidUi5Url('//evil.example/x.js')).toBe(false)
        expect(isValidUi5Url('https://x/"><script>')).toBe(false)
        expect(isValidUi5Url('')).toBe(false)
    })

    it('falls back with a warning on a bad configured url', () => {
        const { url, warnings } = resolveUi5Url({ ui5Url: 'javascript:alert(1)' })
        expect(url).toContain(DEFAULT_UI5_VERSION)
        expect(warnings).toHaveLength(1)
    })

    it('rewrites the bootstrap script src', () => {
        const html = '<script id="sap-ui-bootstrap" src="old.js" data-x="1"></script>'
        expect(renderIndexHtml(html, '/new.js')).toContain('src="/new.js"')
    })

    it('lists the console exactly once on the index page', () => {
        const app = fakeApp()
        mountFederationConsole(app, options)
        expect(app._app_links).toEqual(['/federation-console'])
    })

    it('guards the route before anything serves a file', () => {
        // Order is the security property: static files sit outside CAP's
        // service adapters and inherit nothing from @requires on the model.
        const app = fakeApp()
        mountFederationConsole(app, options)
        expect(app.mounts[0].handlers).toContain(requireAuthenticatedUser)
        expect(app.mounts[0].static).toBeUndefined()
    })

    describe('the guard follows the model', () => {
        // Secure by default, but an app that deliberately opens the service
        // should not be locked out of its own console.
        const cds = require('@sap/cds')
        let savedModel, savedContext

        const withModel = (requires) => {
            cds.model = { definitions: { FederationManagementService: { '@requires': requires } } }
        }
        const asUser = (roles) => {
            cds.context = { user: { is: r => roles.includes(r) } }
        }
        const call = () => {
            const headers = {}
            let status
            const res = {
                status: c => { status = c; return res },
                set: (n, v) => { headers[n] = v; return res },
                end: () => {},
            }
            let nexted = false
            requireAuthenticatedUser({}, res, () => { nexted = true })
            return { status, headers, nexted }
        }

        beforeEach(() => { savedModel = cds.model; savedContext = cds.context })
        afterEach(() => { cds.model = savedModel; cds.context = savedContext })

        it('challenges an anonymous caller when the service requires a user', () => {
            withModel('authenticated-user')
            asUser([])
            const { status, headers, nexted } = call()
            expect(nexted).toBe(false)
            expect(status).toBe(401)
            expect(headers['WWW-Authenticate']).toContain('Basic')
        })

        it('lets an authenticated caller through', () => {
            withModel('authenticated-user')
            asUser(['authenticated-user'])
            expect(call().nexted).toBe(true)
        })

        it('forbids, not challenges, a signed-in user missing the role', () => {
            // Re-prompting for credentials they already have is a dead end.
            withModel('FederationAdmin')
            asUser(['authenticated-user'])
            const { status, nexted } = call()
            expect(nexted).toBe(false)
            expect(status).toBe(403)
        })

        it('honours a custom role', () => {
            withModel('FederationAdmin')
            asUser(['authenticated-user', 'FederationAdmin'])
            expect(call().nexted).toBe(true)
        })

        it('opens the console when the service is deliberately open', () => {
            withModel(null)
            asUser([])
            expect(call().nexted).toBe(true)
        })
    })

    describe('directory redirect', () => {
        // The index page declares its resource root relatively ("./"), so
        // without a trailing slash the browser resolves modules against the
        // server root and asks for /Component.js. The CDS index page links to
        // the mount without a slash, so this is the common way in.
        const run = (originalUrl, path = '/') => {
            let redirect
            let nexted = false
            redirectToDirectory('/federation-console')(
                { path, originalUrl },
                { redirect: (status, to) => { redirect = { status, to } } },
                () => { nexted = true },
            )
            return { redirect, nexted }
        }

        it('redirects the bare mount to the directory form', () => {
            const { redirect } = run('/federation-console')
            expect(redirect).toEqual({ status: 302, to: '/federation-console/' })
        })

        it('passes the directory form straight through', () => {
            const { redirect, nexted } = run('/federation-console/')
            expect(redirect).toBeUndefined()
            expect(nexted).toBe(true)
        })

        it('keeps the query string', () => {
            const { redirect } = run('/federation-console?tab=overview')
            expect(redirect.to).toBe('/federation-console/?tab=overview')
        })

        it('leaves requests for actual files alone', () => {
            const { nexted } = run('/federation-console/Component.js', '/Component.js')
            expect(nexted).toBe(true)
        })
    })

    it('redirects before the index handler runs', () => {
        const app = fakeApp()
        mountFederationConsole(app, options)
        // guard, redirect, index, static
        expect(app.mounts).toHaveLength(4)
        expect(app.mounts[1].handlers).toHaveLength(1)
    })

    it('reports when the app cannot serve static folders', () => {
        expect(mountFederationConsole({ use: () => {} }, options)).toBe(false)
        expect(mountFederationConsole(undefined, options)).toBe(false)
    })
})
