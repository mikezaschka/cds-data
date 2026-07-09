'use strict'

const httpProxy = require('http-proxy')
const hook = require('ui5-utils-express/lib/hook')

const BACKEND_PORT = 4100
const target = `http://127.0.0.1:${BACKEND_PORT}`

function shouldProxy(pathname) {
    return pathname.startsWith('/pipeline')
}

/**
 * UI5 dev middleware: proxy /pipeline to the pipeline-console dev backend (:4100).
 * Start: bash examples/_dev/pipeline-console/start.sh
 */
module.exports = async function pipelineConsoleDevProxy({ log }) {
    const proxy = httpProxy.createProxyServer({ changeOrigin: true, xfwd: true })

    proxy.on('error', (err, req, res) => {
        log.warn(`[pipeline-console-dev-proxy] ${err.message}`)
        if (res && typeof res.writeHead === 'function' && !res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end(
                `Dev backend unavailable on port ${BACKEND_PORT} (${err.message}).\n` +
                    'Start: bash examples/_dev/pipeline-console/start.sh\n' +
                    'Then:  npm run dev:pipeline-console\n',
            )
        }
    })

    return hook(
        'pipeline-console-dev-proxy',
        () => {
            log.info(`[pipeline-console-dev-proxy] Proxying /pipeline to ${target}`)
        },
        (req, res, next) => {
            const pathname = req.url?.split('?')[0] || ''
            if (!shouldProxy(pathname)) {
                next()
                return
            }
            proxy.web(req, res, { target }, (err) => {
                if (err) {
                    log.warn(`[pipeline-console-dev-proxy] ${err.message}`)
                }
            })
        },
    )
}
