process.env.CDS_ENV = 'development'

const path = require('path')
require('@sap/cds')
const cds = global.cds

cds.root = path.resolve(__dirname, '../fixtures/consumer')
process.env.CDS_MATERIALIZATION_TEST_CONSUMER = 'true'
