const { getProviderODataV4Base } = require('./providerTestHttp')

/**
 * Reads one provider Customers row via the running fixture OData (child process), not the consumer DB.
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
async function getProviderCustomerById(id) {
    const b = getProviderODataV4Base()
    const r = await fetch(`${b}/Customers('${id}')`)
    if (r.status === 404) return undefined
    if (!r.ok) throw new Error(`getProviderCustomerById: ${r.status} ${await r.text()}`)
    return r.json()
}

module.exports = { getProviderCustomerById }
