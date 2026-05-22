/**
 * Starts fixture OData / REST servers for integration tests.
 * Ports are chosen dynamically so CI runners never hit EADDRINUSE on fixed ports.
 */
const net = require('net')
const { spawn } = require('child_process')
const path = require('path')
require('@sap/cds')
const cds = global.cds

const PROVIDER_DIR = path.join(__dirname, '../fixtures/provider')
const INVENTORY_DIR = path.join(__dirname, '../fixtures/inventory')
const REST_PROVIDER_DIR = path.join(__dirname, '../fixtures/rest-provider')

let _providerPort = null
let _inventoryPort = null
let _restProviderPort = null

let providerProcess = null
let inventoryProcess = null
let restProviderProcess = null

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

function applyProviderServiceUrls(port) {
    const base = `http://localhost:${port}`
    const r = (cds.env.requires ||= {})
    const ps = (r.ProviderService ||= {})
    const psCreds = (ps.credentials ||= {})
    psCreds.url = `${base}/odata/v4/provider`
    const v2 = (r.ProviderServiceV2 ||= {})
    const v2Creds = (v2.credentials ||= {})
    v2Creds.url = `${base}/odata/v2/provider`
}

function applyInventoryServiceUrl(port) {
    const r = (cds.env.requires ||= {})
    const inv = (r.InventoryService ||= {})
    const creds = (inv.credentials ||= {})
    creds.url = `http://localhost:${port}/odata/v4/inventory`
}

function applyRestProviderUrl(port) {
    const r = (cds.env.requires ||= {})
    const rest = (r.RestProvider ||= {})
    const creds = (rest.credentials ||= {})
    creds.url = `http://localhost:${port}`
}

function isServerReady(output) {
    return output.includes('server listening')
        || output.includes('listening on { url:')
        || /serving \w+Service/.test(output)
}

function startServer(name, dir, port) {
    return new Promise((resolve, reject) => {
        const proc = spawn('npx', ['cds-serve', '--port', String(port)], {
            cwd: dir,
            env: { ...process.env, CDS_ENV: 'development' },
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
        const succeed = (p) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            resolve(p)
        }

        const onData = (data) => {
            output += data.toString()
            if (isServerReady(output)) succeed(proc)
        }

        proc.stdout.on('data', onData)
        proc.stderr.on('data', onData)

        proc.on('error', (err) => {
            fail(new Error(`Failed to start ${name}: ${err.message}`))
        })

        proc.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                fail(new Error(`${name} exited with code ${code}: ${output}`))
            }
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

async function startProvider() {
    if (providerProcess) return _providerPort
    const port = await getFreePort()
    applyProviderServiceUrls(port)
    _providerPort = port
    providerProcess = await startServer('Provider', PROVIDER_DIR, port)
    return _providerPort
}

async function stopProvider() {
    await stopServer(providerProcess)
    providerProcess = null
    _providerPort = null
}

async function startInventoryProvider() {
    if (inventoryProcess) return _inventoryPort
    const port = await getFreePort()
    applyInventoryServiceUrl(port)
    _inventoryPort = port
    inventoryProcess = await startServer('Inventory', INVENTORY_DIR, port)
    return _inventoryPort
}

async function stopInventoryProvider() {
    await stopServer(inventoryProcess)
    inventoryProcess = null
    _inventoryPort = null
}

function startNodeServer(name, script, port) {
    return new Promise((resolve, reject) => {
        const proc = spawn('node', [script], {
            cwd: path.dirname(script),
            env: { ...process.env, PORT: String(port) },
            stdio: ['ignore', 'pipe', 'pipe'],
        })

        let output = ''
        let settled = false
        const timeout = setTimeout(() => {
            if (settled) return
            settled = true
            reject(new Error(`${name} did not start within 15s. Output:\n${output}`))
        }, 15000)

        const fail = (err) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            reject(err)
        }
        const succeed = (p) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            resolve(p)
        }

        const onData = (data) => {
            output += data.toString()
            if (isServerReady(output) || output.includes('listening on port')) succeed(proc)
        }

        proc.stdout.on('data', onData)
        proc.stderr.on('data', onData)

        proc.on('error', (err) => {
            fail(new Error(`Failed to start ${name}: ${err.message}`))
        })

        proc.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                fail(new Error(`${name} exited with code ${code}: ${output}`))
            }
        })
    })
}

async function startRestProvider() {
    if (restProviderProcess) return _restProviderPort
    const port = await getFreePort()
    applyRestProviderUrl(port)
    _restProviderPort = port
    restProviderProcess = await startNodeServer(
        'REST Provider',
        path.join(REST_PROVIDER_DIR, 'server.js'),
        port,
    )
    return _restProviderPort
}

async function stopRestProvider() {
    await stopServer(restProviderProcess)
    restProviderProcess = null
    _restProviderPort = null
}

module.exports = {
    startProvider,
    stopProvider,
    startInventoryProvider,
    stopInventoryProvider,
    startRestProvider,
    stopRestProvider,
    get PROVIDER_PORT() { return _providerPort },
    get INVENTORY_PORT() { return _inventoryPort },
    get REST_PROVIDER_PORT() { return _restProviderPort },
}
