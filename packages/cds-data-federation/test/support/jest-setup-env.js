/**
 * Jest setupFiles run before test modules load. CAP resolves cds.env from
 * cds.root on first access; default root is process.cwd() (package dir), which
 * would not load the federation test consumer app.
 */
process.env.CDS_ENV = 'development'

const path = require('path')
require('@sap/cds')
const cds = global.cds

cds.root = path.resolve(__dirname, '../fixtures/consumer')
