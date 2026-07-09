const cds = require('@sap/cds')

/** @type {Map<string, object>} */
const factsByCode = new Map()

module.exports = cds.service.impl(async function ReportingService() {
    this.on('upsertBatch', async (req) => {
        for (const row of req.data.rows || []) {
            if (row?.code != null) {
                factsByCode.set(row.code, { ...row })
            }
        }
    })

    this.on('truncate', async () => {
        factsByCode.clear()
    })

    this.on('READ', 'CarrierFacts', async () => [...factsByCode.values()])
})
