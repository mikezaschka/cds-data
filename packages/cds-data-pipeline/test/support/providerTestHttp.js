const setup = require('./setup')

function getProviderODataV4Base() {
    const p = setup.PROVIDER_PORT
    if (!p) throw new Error('startProvider() must run first')
    return `http://127.0.0.1:${p}/odata/v4/provider`
}

/**
 * @param {string} id
 * @returns {Promise<object>}
 */
async function postEmitCustomerKeyTest(id) {
    const b = getProviderODataV4Base()
    const r = await fetch(`${b}/emitCustomerKeyTest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ID: id }),
    })
    if (!r.ok) throw new Error(`emitCustomerKeyTest failed: ${r.status} ${await r.text()}`)
    return r.json()
}

/**
 * @param {string} id
 * @returns {Promise<object>}
 */
async function postEmitCustomerPayloadTest(id) {
    const b = getProviderODataV4Base()
    const r = await fetch(`${b}/emitCustomerPayloadTest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ID: id }),
    })
    if (!r.ok) throw new Error(`emitCustomerPayloadTest failed: ${r.status} ${await r.text()}`)
    return r.json()
}

module.exports = { getProviderODataV4Base, postEmitCustomerKeyTest, postEmitCustomerPayloadTest }
