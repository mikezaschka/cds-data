const cds = require('@sap/cds')

class BaseAdapter {
    constructor(service, config) {
        this.service = service
        this.config = config
        this.LOG = cds.log('cds-data-federation')
    }

    /**
     * Yields batches of source records as an async generator.
     * @param {object} _tracker - Federations row: { lastSync, lastKey, status }
     * @yields {object[]} Array of records per batch
     */
    // eslint-disable-next-line require-yield, no-unused-vars
    async *readStream(_tracker) {
        throw new Error('readStream() not implemented')
    }
}

module.exports = BaseAdapter
