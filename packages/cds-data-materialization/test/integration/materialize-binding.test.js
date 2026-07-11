const path = require('path')
const cds = require('@sap/cds')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('Materialize binding (@materialize.snapshot → pipeline)', () => {
    const { GET, expect } = cds.test(consumerRoot)

    it('[M-4] binding: registers materialize pipeline on DataPipelineService', async () => {
        const rows = await SELECT.from('plugin_data_pipeline_Pipelines')
        const names = rows.map(r => r.name)
        expect(names).to.include('DailyCustomerRevenue')
    })

    it('[M-7] binding: execute fills materialized target table', async () => {
        const srv = await cds.connect.to('data-pipeline')
        const db = await cds.connect.to('db')
        await db.run(DELETE.from('consumer.DailyCustomerRevenue'))
        await srv.execute('DailyCustomerRevenue', { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.DailyCustomerRevenue').orderBy('customerId')
        expect(rows.length).to.equal(3)
        const c1 = rows.find(r => r.customerId === 'c1')
        expect(Number(c1.totalAmount)).to.equal(150)
        expect(c1.orderCount).to.equal(2)
    })

    it('[M-7] OData exposes materialized entity', async () => {
        const { status } = await GET('/odata/v4/consumer/DailyCustomerRevenue?$top=1')
        expect(status).to.equal(200)
    })
})
