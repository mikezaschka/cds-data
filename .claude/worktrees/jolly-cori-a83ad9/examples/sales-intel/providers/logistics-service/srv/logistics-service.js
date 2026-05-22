const cds = require('@sap/cds')

const CARRIERS_DELAY_MS = Number(process.env.LOGISTICS_CARRIERS_DELAY_MS ?? 2000)

module.exports = cds.service.impl(function () {
    // Deliberately sluggish Carriers read to showcase the caching story end-to-end.
    // First request pays the full delay; a cached consumer sees subsequent requests
    // return in single-digit milliseconds. Tune or disable with LOGISTICS_CARRIERS_DELAY_MS=0.
    this.before('READ', 'Carriers', async () => {
        if (CARRIERS_DELAY_MS > 0) {
            await new Promise(resolve => setTimeout(resolve, CARRIERS_DELAY_MS))
        }
    })
})
