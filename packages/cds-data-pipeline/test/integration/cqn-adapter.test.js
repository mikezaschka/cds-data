const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { getPipelineService, waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('CqnAdapter integration', () => {
    beforeAll(async () => {
        await startProvider()
    }, 60000)

    cds.test(consumerRoot)

    beforeAll(async () => {
        await waitForConsumerFixturePipelines()
    }, 60000)
    afterAll(async () => {
        await stopProvider()
    })

    const PIPELINE_REPLICATE = 'CqnReplicateSourceOrders'

    beforeEach(async () => {
        const srv = await getPipelineService()
        if (srv.pipelines.has(PIPELINE_REPLICATE)) {
            await srv.clear(PIPELINE_REPLICATE)
        } else {
            await srv.addPipeline({
                name: PIPELINE_REPLICATE,
                source: {
                    kind: 'cqn',
                    service: 'db',
                    entity: 'consumer.SourceOrders',
                },
                target: { entity: 'consumer.ReplicatedSourceOrders' },
                mode: 'delta',
                delta: { mode: 'timestamp', field: 'modifiedAt' },
            })
        }
    })

    it('[4.6.3] R-CQN1: entity-shape full sync copies all source rows', async () => {
        const srv = await getPipelineService()
        await srv.execute(PIPELINE_REPLICATE, { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedSourceOrders')
        expect(rows.length).toBe(7)
        expect(rows.map(r => r.ID).sort()).toEqual(
            ['O001', 'O002', 'O003', 'O004', 'O005', 'O006', 'O007'],
        )
    })

    it('[4.6.3] R-CQN2: entity-shape full sync is idempotent', async () => {
        const srv = await getPipelineService()
        await srv.execute(PIPELINE_REPLICATE, { mode: 'full', trigger: 'manual' })
        await srv.execute(PIPELINE_REPLICATE, { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedSourceOrders')
        expect(rows.length).toBe(7)
    })

    it('[4.6.3] R-CQN3: timestamp delta picks up only newer rows', async () => {
        const srv = await getPipelineService()
        await srv.execute(PIPELINE_REPLICATE, { mode: 'full', trigger: 'manual' })
        await new Promise(r => setTimeout(r, 50))
        const db = await cds.connect.to('db')
        await db.run(INSERT.into('consumer.SourceOrders').entries({
            ID: 'O999',
            customerId: 'C001',
            amount: 42.00,
            status: 'completed',
            orderedAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
        }))
        await srv.execute(PIPELINE_REPLICATE, { mode: 'delta', trigger: 'manual' })
        const after = await SELECT.from('consumer.ReplicatedSourceOrders')
        expect(after.find(r => r.ID === 'O999')).toBeTruthy()
        await db.run(DELETE.from('consumer.SourceOrders').where({ ID: 'O999' }))
    })

    it('[4.6.3] R-CQN4: query-shape materialize aggregates with GROUP BY', async () => {
        const srv = await getPipelineService()
        const name = 'CqnMaterializeRevenue'
        if (!srv.pipelines.has(name)) {
            await srv.addPipeline({
                name,
                source: {
                    kind: 'cqn',
                    service: 'db',
                    query: () => SELECT
                        .from('consumer.SourceOrders')
                        .columns(
                            { ref: ['customerId'] },
                            { func: 'sum', args: [{ ref: ['amount'] }], as: 'totalAmount' },
                            { func: 'count', args: [{ val: 1 }], as: 'orderCount' },
                            { func: 'max', args: [{ ref: ['modifiedAt'] }], as: 'lastActivity' },
                        )
                        .where({ status: 'completed' })
                        .groupBy('customerId'),
                },
                target: { entity: 'consumer.DailyCustomerRevenue' },
                refresh: 'full',
            })
        }
        const db = await cds.connect.to('db')
        await db.run(DELETE.from('consumer.DailyCustomerRevenue'))
        await srv.execute(name, { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.DailyCustomerRevenue')
        expect(rows.length).toBe(3)
    })

    it('rejects source.query returning non-SELECT', async () => {
        const srv = await getPipelineService()
        const name = `__cqn_bad_${Date.now()}`
        await srv.addPipeline({
            name,
            source: {
                kind: 'cqn',
                service: 'db',
                query: () => DELETE.from('consumer.SourceOrders'),
            },
            target: { entity: 'consumer.DailyCustomerRevenue' },
        })
        await expect(
            srv.execute(name, { mode: 'full', trigger: 'manual' }),
        ).rejects.toThrow(/SELECT/)
    })
})
