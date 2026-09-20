/**
 * Boots the providers SAP's xtravels app federates from, so the showcase tests
 * exercise real protocol translation (OData / HCQL over HTTP) rather than
 * in-process CQN calls.
 *
 *   xflights           HCQL + OData  — flights, supplements, airlines, airports
 *   HotelsService      OData         — xtravels' bundled late-cut microservice
 *   S/4 BusinessPartner OData V4/V2  — the app's own provider, mocked from the
 *                                      @capire/s4 package's CSVs. V2 is what
 *                                      xtravels' [production] profile binds.
 *
 * xtravels itself lives in a git submodule (examples/xtravels/xtravels). When it
 * is not initialised, `isXtravelsAvailable()` is false and suites skip themselves
 * (`describe.skipIf`) instead of failing.
 */
const net = require('net')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
require('@sap/cds')
const cds = global.cds

const EXAMPLES_DIR = path.join(__dirname, '../../../../examples/xtravels')
const XTRAVELS_DIR = path.join(EXAMPLES_DIR, 'xtravels')
const XFLIGHTS_DIR = path.join(EXAMPLES_DIR, 'xflights')
const HOTELS_DIR = path.join(XTRAVELS_DIR, 'test/providers/hotels')
const S4_PROVIDER_DIR = path.join(XTRAVELS_DIR, 'test/providers/s4')

/** The submodule is present only after `git submodule update --init`. */
function isXtravelsAvailable() {
    return fs.existsSync(path.join(XTRAVELS_DIR, 'package.json'))
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer()
        server.listen(0, () => {
            const addr = server.address()
            const port = typeof addr === 'object' && addr ? addr.port : null
            server.close((err) => (err ? reject(err) : resolve(port)))
        })
        server.on('error', reject)
    })
}

function isServerReady(output) {
    return output.includes('server listening') || output.includes('listening on { url:')
}

function startServer(name, dir, args, port) {
    return new Promise((resolve, reject) => {
        const proc = spawn('npx', [...args, '--port', String(port)], {
            cwd: dir,
            env: {
                ...process.env,
                CDS_ENV: 'development',
                // Never touch the developer's shared ~/.cds-services.json: a stale
                // entry there makes `cds mock` skip mocking the service entirely.
                CDS_CONFIG: JSON.stringify({ no_bindings: true }),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        })

        let output = ''
        let settled = false
        const timeout = setTimeout(() => {
            if (settled) return
            settled = true
            reject(new Error(`${name} did not start within 30s. Output:\n${output}`))
        }, 30000)

        const fail = (err) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            reject(err)
        }

        const onData = (data) => {
            output += data.toString()
            if (settled || !isServerReady(output)) return
            settled = true
            clearTimeout(timeout)
            resolve(proc)
        }

        proc.stdout.on('data', onData)
        proc.stderr.on('data', onData)
        proc.on('error', (err) => fail(new Error(`Failed to start ${name}: ${err.message}`)))
        proc.on('exit', (code) => {
            if (code !== 0 && code !== null) fail(new Error(`${name} exited with code ${code}: ${output}`))
        })
    })
}

function stopServer(proc) {
    if (!proc) return Promise.resolve()
    return new Promise((resolve) => {
        proc.on('exit', () => resolve())
        proc.kill('SIGTERM')
        setTimeout(() => {
            try { proc.kill('SIGKILL') } catch { /* already dead */ }
            resolve()
        }, 5000)
    })
}

// CAP resolves `cds.requires` when it builds cds.env, adding `impl` and
// `external: true` to anything with credentials. A binding assigned afterwards
// skips that step, so a service the app also serves locally (xtravels serves
// HotelsService itself) would silently resolve to the *local* one and never
// touch the network. Spell the resolved shape out.
const REMOTE_IMPL = '@sap/cds/srv/remote-service.js'
const remote = (kind, url) => ({ impl: REMOTE_IMPL, external: true, kind, credentials: { url } })

const processes = []
let ports = null

/**
 * Starts all three providers and points cds.env.requires at them. Must run
 * before `cds.test(XTRAVELS_DIR)` boots the app, so the bindings are in place
 * when the plugin registers its pipelines and delegate handlers.
 */
async function startXtravelsProviders({ s4Protocol = 'v4' } = {}) {
    const [flights, hotels, s4] = await Promise.all([getFreePort(), getFreePort(), getFreePort()])
    ports = { flights, hotels, s4 }

    // The app repo's own provider serves both protocols and seeds the
    // organizations the shipped sample data lacks; only the URL differs.
    const s4Server = startServer('s4', S4_PROVIDER_DIR, ['cds', 'mock', 'API_BUSINESS_PARTNER'], s4)

    processes.push(
        ...(await Promise.all([
            startServer('xflights', XFLIGHTS_DIR, ['cds-serve'], flights),
            startServer('hotels', HOTELS_DIR, ['cds', 'mock', 'sap.capire.hotels.HotelsService'], hotels),
            s4Server,
        ])),
    )

    const requires = (cds.env.requires ||= {})
    requires['sap.capire.flights.FlightsService'] = remote('hcql', `http://localhost:${flights}/hcql/flights`)
    requires['sap.capire.hotels.HotelsService'] = remote('odata', `http://localhost:${hotels}/odata/v4/hotels`)
    const s4Binding = s4Protocol === 'v2'
        ? remote('odata-v2', `http://localhost:${s4}/odata/v2/api-business-partner`)
        : remote('odata', `http://localhost:${s4}/odata/v4/api-business-partner`)
    requires['sap.capire.s4.business-partner'] = s4Binding
    // The @capire/s4 package maps the logical name onto the imported service.
    requires.API_BUSINESS_PARTNER = s4Binding

    return ports
}

async function stopXtravelsProviders() {
    await Promise.all(processes.map(stopServer))
    processes.length = 0
    ports = null
}

module.exports = {
    XTRAVELS_DIR,
    isXtravelsAvailable,
    startXtravelsProviders,
    stopXtravelsProviders,
    get PORTS() { return ports },
}
