const cds = require('@sap/cds')
const { CUSTOMER_KEY_TEST, CUSTOMER_PAYLOAD_TEST } = require('../../../../test/support/provider-event-topics.js')

const LOG = '[fixtures/provider]'

/**
 * Sibling impl for provider-service.cds (see CAP service factory _sibling resolution).
 * @param {import('@sap/cds').Service} srv
 */
module.exports = async (srv) => {
    srv.on('emitCustomerKeyTest', async (req) => {
        const { ID } = req.data
        if (!ID) return req.error(400, 'ID is required')
        const messaging = await cds.connect.to('messaging')
        await messaging.emit(CUSTOMER_KEY_TEST, { ID })
        cds.log(LOG).info('messaging emit', { topic: CUSTOMER_KEY_TEST, ID })
        return { ok: true }
    })
    srv.on('emitCustomerPayloadTest', async (req) => {
        const { ID } = req.data
        if (!ID) return req.error(400, 'ID is required')
        const { Customers } = srv.entities
        const row = await SELECT.one.from(Customers).where({ ID })
        if (!row) return req.error(404, `Customer not found: ${ID}`)
        const { ID: rid, name, city, country, email, blocked, modifiedAt } = row
        const payload = { ID: rid, name, city, country, email, blocked, modifiedAt }
        const messaging = await cds.connect.to('messaging')
        await messaging.emit(CUSTOMER_PAYLOAD_TEST, payload)
        cds.log(LOG).info('messaging emit', { topic: CUSTOMER_PAYLOAD_TEST, ID })
        return { ok: true }
    })
}
