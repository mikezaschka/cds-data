const fs = require('node:fs')
const path = require('node:path')

/**
 * Serving for the Federation Console — ADR 0017 §2.
 *
 * Mirrors `cds-data-pipeline/lib/pipeline-console-bootstrap.js` deliberately:
 * one mechanism for mounting a plugin-owned UI5 app, not two.
 *
 * The UI5 default is the active **long-term maintenance** release rather than
 * the newest feature release. A page hosts one UI5 core, so the three consoles
 * in this suite have to agree on a version before any of them can share
 * controls; LTS is the only version they can all sit on.
 */
const DEFAULT_UI5_VERSION = '1.148.10'
const DEFAULT_UI5_URL = `https://ui5.sap.com/${DEFAULT_UI5_VERSION}/resources/sap-ui-core.js`
const BOOTSTRAP_TAG = /<script\b[^>]*\bid=["']sap-ui-bootstrap["'][^>]*>/i

function isValidUi5Url(url) {
    if (typeof url !== 'string' || !url.trim()) return false
    if (/["'<>\s\\]/.test(url)) return false
    return /^https?:\/\/[^/]/i.test(url) || (url.startsWith('/') && !url.startsWith('//'))
}

/**
 * @param {object} [management] `requires.data-federation.management`
 * @returns {{ url: string, warnings: string[] }}
 */
function resolveUi5Url(management = {}) {
    const warnings = []
    const value = management?.ui5Url
    if (value === undefined) return { url: DEFAULT_UI5_URL, warnings }
    if (!isValidUi5Url(value)) {
        warnings.push(
            'cds-data-federation: ignoring management.ui5Url: expected an http(s) URL ' +
            `or an absolute path, got ${JSON.stringify(value)}.`,
        )
        return { url: DEFAULT_UI5_URL, warnings }
    }
    return { url: value, warnings }
}

function renderIndexHtml(html, ui5Url) {
    return html.replace(BOOTSTRAP_TAG, (tag) =>
        /\bsrc=/i.test(tag)
            ? tag.replace(/\bsrc=["'][^"']*["']/i, `src="${ui5Url}"`)
            : tag.replace(/^<script\b/i, `<script src="${ui5Url}"`),
    )
}

function createIndexHandler(consolePath, ui5Url) {
    const indexPath = path.join(consolePath, 'index.html')
    let rendered

    return (_req, res, next) => {
        try {
            if (rendered === undefined) {
                rendered = renderIndexHtml(fs.readFileSync(indexPath, 'utf8'), ui5Url)
            }
            res.type('html').send(rendered)
        } catch (error) {
            next(error)
        }
    }
}

/**
 * Mount the console on the bootstrapped express app.
 *
 * `app.serve(endpoint).from(...)` both serves the folder and registers the
 * endpoint in `app._app_links`, which is what the server index page lists.
 * Pushing it again by hand would list the console twice — the bug fixed in
 * cds-data-pipeline once already.
 *
 * @param {object} app express app from the `bootstrap` event
 * @param {{ consolePath: string, ui5Url: string }} options
 * @returns {boolean} whether it mounted
 */
function mountFederationConsole(app, { consolePath, ui5Url }) {
    if (!app || typeof app.serve !== 'function') return false
    const serveIndex = createIndexHandler(consolePath, ui5Url)
    // CAP's own request middlewares first: they populate `cds.context.user`,
    // which the guard depends on. Without them the guard rejects everyone,
    // authenticated or not.
    app.use('/federation-console', ...capRequestMiddlewares(), requireAuthenticatedUser)
    app.use('/federation-console', redirectToDirectory('/federation-console'))
    app.use('/federation-console', (req, res, next) =>
        req.path === '/' || req.path === '/index.html' ? serveIndex(req, res, next) : next(),
    )
    app.serve('/federation-console').from('cds-data-federation', 'app/federation-console')
    return true
}

/**
 * Redirect `/mount` to `/mount/`, the way a static file server does for a
 * directory.
 *
 * The index page declares its resource root relatively (`"./"`), so without the
 * trailing slash the browser resolves every module against the server root and
 * asks for `/Component.js` — a 404, and the app never starts. The CDS index
 * page links to the mount without a slash, so this is the path most people
 * arrive by.
 *
 * @param {string} mount the path this console is mounted at
 */
function redirectToDirectory(mount) {
    return (req, res, next) => {
        if (req.path !== '/') return next()
        const [pathname, query] = req.originalUrl.split('?')
        if (pathname.endsWith('/')) return next()
        res.redirect(302, `${mount}/${query ? `?${query}` : ''}`)
    }
}

/**
 * The console is static files served outside CAP's service adapters, so it
 * inherits nothing from `@requires` on the model. Guarding the API alone
 * would leave this route open.
 *
 * Rather than hard-code the requirement, read it from the model: whatever
 * `FederationManagementService` requires, the console requires. Secure by
 * default because the service is annotated `authenticated-user`, and an app
 * that deliberately opens it (`annotate FederationManagementService with
 * @requires: null`) opens both surfaces together instead of being locked out
 * of its own console.
 */
function requireAuthenticatedUser(req, res, next) {
    const cds = require('@sap/cds')
    const required = cds.model?.definitions?.['FederationManagementService']?.['@requires']
    if (!required) return next()

    const roles = Array.isArray(required) ? required : [required]
    const user = cds.context?.user
    if (roles.some(role => user?.is?.(role))) return next()

    // Anonymous callers get a challenge; a signed-in user missing the role is
    // forbidden, not unauthenticated.
    if (user?.is?.('authenticated-user')) {
        return res.status(403).end()
    }
    res.status(401).set('WWW-Authenticate', 'Basic realm="cds-data-federation"').end()
}

/**
 * CAP's own request middlewares (context, trace, auth, model), flattened so
 * they can be spread into `app.use()`. These are what populate
 * `cds.context.user`.
 */
function capRequestMiddlewares() {
    const cds = require('@sap/cds')
    return (cds.middlewares?.before ?? []).flat().filter(Boolean)
}

module.exports = {
    DEFAULT_UI5_VERSION,
    DEFAULT_UI5_URL,
    isValidUi5Url,
    resolveUi5Url,
    renderIndexHtml,
    createIndexHandler,
    mountFederationConsole,
    requireAuthenticatedUser,
    capRequestMiddlewares,
    redirectToDirectory,
}
