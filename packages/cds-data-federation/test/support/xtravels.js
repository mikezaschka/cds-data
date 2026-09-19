/**
 * Boots the providers SAP's xtravels app federates from, so the showcase tests
 * exercise real protocol translation (OData / HCQL over HTTP) rather than
 * in-process CQN calls.
 *
 *   xflights           HCQL + OData  — flights, supplements, airlines, airports
 *   HotelsService      OData         — xtravels' bundled late-cut microservice
 *   S/4 BusinessPartner OData V4/V2  — mocked from the @capire/s4 package's CSVs.
 *                                      V2 is what xtravels' [production] profile
 *                                      binds for a real S/4 system.
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
const S4_DIR = path.join(EXAMPLES_DIR, 's4')
const S4_V2_DIR = path.join(XTRAVELS_DIR, 'test/providers/s4-v2')

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

    // The V2 launcher lives in the app repo so its own suites can use it too.
    const s4Server = s4Protocol === 'v2'
        ? startServer('s4-v2', S4_V2_DIR, ['cds', 'mock', 'API_BUSINESS_PARTNER'], s4)
        : startServer('s4', S4_DIR, ['cds', 'mock', 'API_BUSINESS_PARTNER'], s4)

    processes.push(
        ...(await Promise.all([
            startServer('xflights', XFLIGHTS_DIR, ['cds-serve'], flights),
            startServer('hotels', HOTELS_DIR, ['cds', 'mock', 'sap.capire.hotels.HotelsService'], hotels),
            s4Server,
        ])),
    )

    const requires = (cds.env.requires ||= {})
    requires['sap.capire.flights.FlightsService'] = {
        kind: 'hcql',
        credentials: { url: `http://localhost:${flights}/hcql/flights` },
    }
    requires['sap.capire.hotels.HotelsService'] = {
        kind: 'odata',
        credentials: { url: `http://localhost:${hotels}/odata/v4/hotels` },
    }
    const s4Binding = s4Protocol === 'v2'
        ? { kind: 'odata-v2', credentials: { url: `http://localhost:${s4}/odata/v2/api-business-partner` } }
        : { kind: 'odata', credentials: { url: `http://localhost:${s4}/odata/v4/business-partner` } }
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
