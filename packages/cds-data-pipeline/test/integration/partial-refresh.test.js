const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { getPipelineService, waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('Materialize partial refresh', () => {
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

    it('[4.6.3] R-CQN6: refresh.slice deletes only matching rows before insert', async () => {
        const srv = await getPipelineService()
        const name = 'CqnMaterializeRevenuePartial'
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
                        .where({ status: 'completed', customerId: 'C001' })
                        .groupBy('customerId'),
                },
                target: { entity: 'consumer.DailyCustomerRevenue' },
                refresh: {
                    mode: 'partial',
                    slice: () => ({ customerId: 'C001' }),
                },
            })
        }

        const db = await cds.connect.to('db')
        await db.run(DELETE.from('consumer.DailyCustomerRevenue'))
        await db.run(INSERT.into('consumer.DailyCustomerRevenue').entries({
            customerId: 'C999',
            totalAmount: 999.99,
            orderCount: 42,
            lastActivity: new Date().toISOString(),
        }))

        await srv.execute(name, { mode: 'full', trigger: 'manual' })

        const rows = await SELECT.from('consumer.DailyCustomerRevenue')
        const c999 = rows.find(r => r.customerId === 'C999')
        expect(c999).toBeTruthy()
        expect(Number(c999.totalAmount)).toBe(999.99)

        const c001 = rows.find(r => r.customerId === 'C001')
        expect(c001).toBeTruthy()
        expect(Number(c001.totalAmount)).toBe(350.5)
    })
})
