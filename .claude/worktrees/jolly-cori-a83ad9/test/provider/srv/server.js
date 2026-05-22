// Standalone server entry point for the provider service
// Used by tests to run the provider as a real OData service
const cds = require('@sap/cds')
module.exports = cds.server
