/**
 * Vitest setup for entity-cache multi-tenancy integration tests (EC2).
 * Uses consumer-ec-mt fixture so data-federation-cache + entityCache.urlTemplate load
 * before cds.env is cached (ADR 0010).
 */
process.env.CDS_ENV = 'development'

const path = require('path')
require('@sap/cds')
const cds = global.cds

cds.root = path.resolve(__dirname, '../fixtures/consumer-ec-mt')
