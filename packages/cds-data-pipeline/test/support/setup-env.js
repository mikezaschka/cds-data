/**
 * Vitest `setupFiles` run before each test module loads. CAP resolves cds.env
 * from cds.root on first access; default root is process.cwd() (repo root),
 * which would load the plugin's package.json instead of the test consumer app.
 */
process.env.CDS_PIPELINE_TEST_CONSUMER = 'true'
process.env.CDS_PIPELINE_TEST_MESSAGING = 'true'
process.env.CDS_ENV = 'development'

const fs = require('fs')
const path = require('path')
// Single CAP facade for plugin + fixture hooks (see cds-plugin.js).
require('@sap/cds')
const cds = global.cds

cds.root = path.resolve(__dirname, '../fixtures/consumer')

const messagingDir = path.resolve(__dirname, '../.messaging-shared')
fs.mkdirSync(messagingDir, { recursive: true })
process.env.PIPELINE_TEST_MESSAGING_DIR = messagingDir
