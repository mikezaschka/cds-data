const BaseSourceAdapter = require('./BaseSourceAdapter')
const { entityShapeReadStream } = require('./lib/entityShapeReadStream')

/**
 * Remote CQN source adapter. Reads entity-shape sources via CQN dispatched to a
 * connected CAP remote service. CAP selects the wire protocol (OData V4, OData V2,
 * or HCQL) from the provider's served protocols and the consumer's `cds.requires`
 * binding — this adapter does not serialize HTTP itself.
 */
class RemoteCqnAdapter extends BaseSourceAdapter {
    constructor(service, config) {
        super(service, config)
    }

    async *readStream(tracker) {
        yield* entityShapeReadStream({
            service: this.service,
            config: this.config,
            tracker,
            buildDeltaFilter: (delta, t, svc) => this._buildDeltaFilter(delta, t, svc),
        })
    }

    _buildDeltaFilter(delta, tracker, service) {
        const { mode = 'timestamp', field = 'modifiedAt' } = delta

        // Federation entity-cache pipelines: full read every run; tracker lastSync is bookkeeping.
        if (mode === 'none') return {}

        if (!tracker.lastSync) return {}

        switch (mode) {
            case 'timestamp': {
                let timestamp = new Date(tracker.lastSync).toISOString()
                if (service?.options?.kind === 'odata-v2') {
                    timestamp = timestamp.slice(0, -1)
                }
                return { [field]: { '>': timestamp } }
            }
            case 'key':
                if (!tracker.lastKey) return {}
                return { [field]: { '>': tracker.lastKey } }

            case 'datetime-fields': {
                const { dateField, timeField } = delta
                if (!dateField || !timeField) {
                    this.LOG.warn('datetime-fields delta mode requires dateField and timeField')
                    return {}
                }
                const lastSyncDate = new Date(tracker.lastSync)
                const dateStr = lastSyncDate.toISOString().split('T')[0]
                const timeStr = lastSyncDate.toTimeString().split(' ')[0]
                return `(${dateField} gt '${dateStr}' or (${dateField} eq '${dateStr}' and ${timeField} gt '${timeStr}'))`
            }
            default:
                return {}
        }
    }
}

module.exports = RemoteCqnAdapter
