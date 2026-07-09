/**
 * Vitest setup for optional Postgres smoke tests.
 * Sets CDS_TEST_DB=postgres and overrides the consumer sqlite binding.
 */
process.env.CDS_TEST_DB = 'postgres'
process.env.CDS_PIPELINE_TEST_MESSAGING = 'false'
require('@cap-js/postgres')
require('./setup-env.js')
const { applyPostgresDbConfig } = require('./db-config')
applyPostgresDbConfig()
