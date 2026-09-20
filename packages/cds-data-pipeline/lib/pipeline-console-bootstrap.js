const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_UI5_VERSION = '1.150.0'
const DEFAULT_UI5_URL = `https://ui5.sap.com/${DEFAULT_UI5_VERSION}/resources/sap-ui-core.js`
const BOOTSTRAP_TAG = /<script\b[^>]*\bid=["']sap-ui-bootstrap["'][^>]*>/i

function isValidUi5Url(url) {
    if (typeof url !== 'string' || !url.trim()) return false
    if (/["'<>\s\\]/.test(url)) return false
    return /^https?:\/\/[^/]/i.test(url) || (url.startsWith('/') && !url.startsWith('//'))
}

function resolveUi5Url(entries = []) {
    const warnings = []
    const configured = []

    for (const { name, normalized } of entries) {
        const value = normalized?.management?.ui5Url
        if (value === undefined) continue

        if (!isValidUi5Url(value)) {
            warnings.push(
                `cds-data-pipeline: ignoring management.ui5Url of service "${name}": ` +
                    `expected an http(s) URL or an absolute path, got ${JSON.stringify(value)}.`,
            )
            continue
        }
        configured.push({ name, value })
    }

    const distinct = [...new Set(configured.map(({ value }) => value))]
    if (distinct.length > 1) {
        warnings.push(
            `cds-data-pipeline: services configure different management.ui5Url values ` +
                `(${distinct.join(', ')}); using ${distinct[0]} for the Pipeline Console.`,
        )
    }

    return { url: distinct[0] || DEFAULT_UI5_URL, warnings }
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
 * Mounts the Pipeline Console on the bootstrapped express app.
 *
 * `app.serve(endpoint).from(...)` serves the folder *and* registers the
 * endpoint in `app._app_links`, which is what the server's index page lists
 * under "Web Applications" (@sap/cds/server.js, unchanged since 9.0.2). Pushing
 * it again here would list the console twice.
 *
 * @param {object} app - the express app handed to the `bootstrap` event
 * @param {object} options
 * @param {string} options.consolePath - absolute path to the built console app
 * @param {string} options.ui5Url - UI5 runtime the index page bootstraps from
 * @returns {boolean} whether the console was mounted
 */
function mountPipelineConsole(app, { consolePath, ui5Url }) {
    if (!app || typeof app.serve !== 'function') return false
    const serveIndex = createIndexHandler(consolePath, ui5Url)
    // CAP's request middlewares first: they populate `cds.context.user`, which
    // the guard depends on. Without them the guard rejects every caller.
    app.use('/pipeline-console', ...capRequestMiddlewares(), requireAuthenticatedUser)
    app.use('/pipeline-console', redirectToDirectory('/pipeline-console'))
    app.use('/pipeline-console', (req, res, next) =>
        req.path === '/' || req.path === '/index.html' ? serveIndex(req, res, next) : next(),
    )
    app.serve('/pipeline-console').from('cds-data-pipeline', 'app/pipeline-console')
    return true
}

/**
 * Redirect `/mount` to `/mount/`, the way a static file server does for a
 * directory. The index page declares its resource root relatively (`"./"`), so
 * without the trailing slash the browser resolves modules against the server
 * root and asks for `/Component.js`, which 404s. The CDS index page links to
 * the mount without a slash.
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
 * inherits nothing from `@requires` on the model. Guarding the management
 * service alone would leave this route open.
 */
function requireAuthenticatedUser(req, res, next) {
    const cds = require('@sap/cds')
    const user = cds.context?.user
    if (user?.is?.('authenticated-user')) return next()
    res.status(401).set('WWW-Authenticate', 'Basic realm="cds-data-pipeline"').end()
}

/**
 * CAP's own request middlewares (context, trace, auth, model), flattened so
 * they can be spread into `app.use()`.
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
    mountPipelineConsole,
    requireAuthenticatedUser,
    capRequestMiddlewares,
    redirectToDirectory,
}
