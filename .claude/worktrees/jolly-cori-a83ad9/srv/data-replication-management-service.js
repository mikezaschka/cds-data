const cds = require('@sap/cds')

class DataFederationService extends cds.ApplicationService {
    async init() {
        this.on('run', async (req) => {
            const { name, mode } = req.data
            try {
                const srv = await cds.connect.to('DataReplicationService')
                await srv.run(name, mode || 'delta', 'manual')
                return `Replication '${name}' completed successfully`
            } catch (err) {
                req.error(500, `Replication '${name}' failed: ${err.message}`)
            }
        })

        this.on('flush', async (req) => {
            const { name } = req.data
            try {
                const srv = await cds.connect.to('DataReplicationService')
                await srv.clear(name)
                return `Replication '${name}' flushed successfully`
            } catch (err) {
                req.error(500, `Flush '${name}' failed: ${err.message}`)
            }
        })

        this.on('status', async (req) => {
            const { name } = req.data
            try {
                const srv = await cds.connect.to('DataReplicationService')
                return await srv.getStatus(name)
            } catch (err) {
                req.error(500, `Status check failed: ${err.message}`)
            }
        })

        await super.init()
    }
}

module.exports = DataFederationService
