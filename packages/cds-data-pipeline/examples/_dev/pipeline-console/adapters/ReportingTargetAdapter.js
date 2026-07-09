const cds = require('@sap/cds')
const BaseTargetAdapter = require('cds-data-pipeline/srv/adapters/targets/BaseTargetAdapter')

/**
 * Forwards MAP rows to ReportingService via CAP events (no CQN target).
 * Used by the Pipeline Console dev backend to exercise custom write adapters.
 */
class ReportingTargetAdapter extends BaseTargetAdapter {
    async getReporting() {
        if (!this._reporting) {
            const targetService = this.config.target && this.config.target.service
            this._reporting = this.service || await cds.connect.to(targetService)
        }
        return this._reporting
    }

    async writeBatch(records, { mode }) {
        if (!records || records.length === 0) {
            return { created: 0, updated: 0, deleted: 0 }
        }
        if (mode === 'snapshot') {
            throw new Error('ReportingTargetAdapter: snapshot writes are not supported')
        }
        const svc = await this.getReporting()
        await svc.send('upsertBatch', { rows: records })
        return { created: records.length, updated: 0, deleted: 0 }
    }

    async truncate() {
        const svc = await this.getReporting()
        await svc.send('truncate', {})
    }

    async deleteSlice() {
        throw new Error('ReportingTargetAdapter: deleteSlice is not supported')
    }

    capabilities() {
        return {
            batchInsert: false,
            keyAddressableUpsert: true,
            batchDelete: false,
            truncate: true,
        }
    }
}

module.exports = ReportingTargetAdapter
