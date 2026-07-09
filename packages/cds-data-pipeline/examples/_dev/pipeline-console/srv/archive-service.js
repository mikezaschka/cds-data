const cds = require('@sap/cds')

const STORAGE_ENTITY = 'archiveDev.ShipmentArchive'

module.exports = async (srv) => {
    const archiveDb = await cds.connect.to('ArchiveDb')
    srv.on('READ', 'ShipmentArchive', async (req) => {
        const query = cds.ql.clone(req.query)
        if (query.SELECT?.from) {
            query.SELECT.from = { ref: [STORAGE_ENTITY] }
        }
        return archiveDb.run(query)
    })
}
