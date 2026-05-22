const cds = require('@sap/cds')

module.exports = cds.service.impl(async function () {
    this.on('runEventDelete', async (req) => {
        const { id } = req.data
        if (!id) return req.error(400, 'id is required')
        const pipelines = await cds.connect.to('DataPipelineService')
        await pipelines.executeEvent('Shipments', {
            event: { read: 'key', action: 'delete', keys: { ID: id } },
        })
        return { ok: true }
    })
})
