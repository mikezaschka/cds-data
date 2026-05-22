const cds = global.cds
if (!cds) throw new Error('global.cds must be set before messaging-pipeline-bridge.js')
const { CUSTOMER_KEY_TEST, CUSTOMER_PAYLOAD_TEST } = require('../../../test/support/provider-event-topics.js')

const LOG = 'test-messaging-bridge'

cds.on('served', () => {
    if (process.env.CDS_PIPELINE_TEST_MESSAGING !== 'true') return
    // Must return a Promise: cds.emit('served') is awaited before app.listen, so
    // messaging.on runs before the 'listening' event — otherwise file-based-messaging
    // may call startWatching() with zero subscriptions and never poll the queue.
    return run()
})

async function run() {
    const messaging = await cds.connect.to('messaging')
    const pipelines = await cds.connect.to('DataPipelineService')
    const log = cds.log(LOG)

    messaging.on(CUSTOMER_KEY_TEST, async (msg) => {
        const { ID } = msg.data
        if (!ID) {
            log.warn('CustomerKeyTest missing data.ID', msg)
            return
        }
        await pipelines.execute('ReplicatedCustomers', {
            trigger: 'event',
            event: { read: 'key', action: 'upsert', keys: { ID } },
        })
    })
    messaging.on(CUSTOMER_PAYLOAD_TEST, async (msg) => {
        const p = msg.data
        if (!p || !p.ID) {
            log.warn('CustomerPayloadTest missing data', msg)
            return
        }
        const payload = { ...p }
        await pipelines.execute('ReplicatedCustomers', {
            trigger: 'event',
            event: { read: 'payload', action: 'upsert', payload },
        })
    })
    log.info('subscribed to', CUSTOMER_KEY_TEST, CUSTOMER_PAYLOAD_TEST)
}
