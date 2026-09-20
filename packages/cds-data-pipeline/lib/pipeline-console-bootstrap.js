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
    app.use('/pipeline-console', (req, res, next) =>
        req.path === '/' || req.path === '/index.html' ? serveIndex(req, res, next) : next(),
    )
    app.serve('/pipeline-console').from('cds-data-pipeline', 'app/pipeline-console')
    return true
}

module.exports = {
    DEFAULT_UI5_VERSION,
    DEFAULT_UI5_URL,
    isValidUi5Url,
    resolveUi5Url,
    renderIndexHtml,
    createIndexHandler,
    mountPipelineConsole,
}
