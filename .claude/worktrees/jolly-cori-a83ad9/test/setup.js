/**
 * Test setup: starts provider CAP apps as real OData servers.
 *
 * - Provider (port 4444): OData V4 + V2 via @cap-js-community/odata-v2-adapter
 * - Inventory (port 4445): OData V4 only
 */
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')

const PROVIDER_DIR = path.join(__dirname, 'provider')
const INVENTORY_DIR = path.join(__dirname, 'inventory')
const REST_PROVIDER_DIR = path.join(__dirname, 'rest-provider')
const PROVIDER_PORT = 4444
const INVENTORY_PORT = 4445
const REST_PROVIDER_PORT = 4446

let providerProcess = null
let inventoryProcess = null
let restProviderProcess = null

function startServer(name, dir, port) {
    return new Promise((resolve, reject) => {
        const proc = spawn('npx', ['cds-serve', '--port', String(port)], {
            cwd: dir,
            env: { ...process.env, CDS_ENV: 'test' },
            stdio: ['ignore', 'pipe', 'pipe']
        })

        let output = ''

        proc.stdout.on('data', (data) => {
            output += data.toString()
            if (output.includes('server listening')) {
                resolve(proc)
            }
        })

        proc.stderr.on('data', (data) => {
            output += data.toString()
        })

        proc.on('error', (err) => {
            reject(new Error(`Failed to start ${name}: ${err.message}`))
        })

        proc.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                reject(new Error(`${name} exited with code ${code}: ${output}`))
            }
        })

        setTimeout(() => {
            reject(new Error(`${name} did not start within 30s. Output:\n${output}`))
        }, 30000)
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
    if (providerProcess) return PROVIDER_PORT
    providerProcess = await startServer('Provider', PROVIDER_DIR, PROVIDER_PORT)
    return PROVIDER_PORT
}

async function stopProvider() {
    await stopServer(providerProcess)
    providerProcess = null
}

async function startInventoryProvider() {
    if (inventoryProcess) return INVENTORY_PORT
    inventoryProcess = await startServer('Inventory', INVENTORY_DIR, INVENTORY_PORT)
    return INVENTORY_PORT
}

async function stopInventoryProvider() {
    await stopServer(inventoryProcess)
    inventoryProcess = null
}

function startNodeServer(name, script, port) {
    return new Promise((resolve, reject) => {
        const proc = spawn('node', [script], {
            cwd: path.dirname(script),
            env: { ...process.env, PORT: String(port) },
            stdio: ['ignore', 'pipe', 'pipe']
        })

        let output = ''

        proc.stdout.on('data', (data) => {
            output += data.toString()
            if (output.includes('server listening') || output.includes('listening on port')) {
                resolve(proc)
            }
        })

        proc.stderr.on('data', (data) => {
            output += data.toString()
        })

        proc.on('error', (err) => {
            reject(new Error(`Failed to start ${name}: ${err.message}`))
        })

        proc.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                reject(new Error(`${name} exited with code ${code}: ${output}`))
            }
        })

        setTimeout(() => {
            reject(new Error(`${name} did not start within 15s. Output:\n${output}`))
        }, 15000)
    })
}

async function startRestProvider() {
    if (restProviderProcess) return REST_PROVIDER_PORT
    restProviderProcess = await startNodeServer(
        'REST Provider',
        path.join(REST_PROVIDER_DIR, 'server.js'),
        REST_PROVIDER_PORT
    )
    return REST_PROVIDER_PORT
}

async function stopRestProvider() {
    await stopServer(restProviderProcess)
    restProviderProcess = null
}

async function waitForProvider(port, maxRetries = 20) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            await new Promise((resolve, reject) => {
                const req = http.get(`http://localhost:${port}/`, (res) => {
                    res.resume()
                    resolve()
                })
                req.on('error', reject)
                req.setTimeout(500, () => { req.destroy(); reject(new Error('timeout')) })
            })
            return
        } catch {
            await new Promise(r => setTimeout(r, 500))
        }
    }
    throw new Error(`Provider not reachable on port ${port}`)
}

module.exports = {
    startProvider, stopProvider,
    startInventoryProvider, stopInventoryProvider,
    startRestProvider, stopRestProvider,
    waitForProvider,
    PROVIDER_PORT, INVENTORY_PORT, REST_PROVIDER_PORT
}
