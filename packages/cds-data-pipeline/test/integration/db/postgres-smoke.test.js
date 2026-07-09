/**
 * Optional Postgres smoke suite — DB-specific paths not covered by the default
 * SQLite integration matrix. Run via:
 *
 *   docker compose -f docker/docker-compose.postgres.yml up -d
 *   npm run test:integration:postgres -w cds-data-pipeline
 */
const path = require('path')
const cds = require('@sap/cds')
const { getPipelineService, waitForConsumerFixturePipelines } = require('../../support/helpers')
const { deployPostgresFixture } = require('../../support/db-config')

const consumerRoot = path.join(__dirname, '../../fixtures/consumer')

const CQN_REPLICATE = 'PostgresSmokeCqnReplicate'
const CQN_MATERIALIZE = 'PostgresSmokeCqnMaterialize'
const CQN_PARTIAL = 'PostgresSmokeCqnPartial'

describe('Postgres smoke (tracker, UPSERT, query-shape refresh)', () => {
    beforeAll(async () => {
        await deployPostgresFixture()
    }, 120000)

    cds.test(consumerRoot)

    beforeAll(async () => {
        await waitForConsumerFixturePipelines()

        const srv = await getPipelineService()

        if (!srv.pipelines.has(CQN_REPLICATE)) {
            await srv.addPipeline({
                name: CQN_REPLICATE,
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

        if (!srv.pipelines.has(CQN_MATERIALIZE)) {
            await srv.addPipeline({
                name: CQN_MATERIALIZE,
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

        if (!srv.pipelines.has(CQN_PARTIAL)) {
            await srv.addPipeline({
                name: CQN_PARTIAL,
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
        if (cds.env.requires?.db?.kind !== 'postgres') {
            throw new Error(`Expected postgres db binding, got kind=${cds.env.requires?.db?.kind ?? 'undefined'}`)
        }
        await db.run('SELECT 1 AS ok')
    }, 120000)


    it('parallel execute: concurrency guard skips overlapping run', async () => {
        const srv = await getPipelineService()
        const delayFlag = { armed: false }
        srv.before('PIPELINE.READ', CQN_REPLICATE, async () => {
            if (delayFlag.armed) return
            delayFlag.armed = true
            await new Promise(r => setTimeout(r, 400))
        })

        const results = await Promise.all([
            srv.execute(CQN_REPLICATE, { mode: 'full', trigger: 'manual' }),
            srv.execute(CQN_REPLICATE, { mode: 'full', trigger: 'manual' }),
        ])
        const settled = await Promise.all(results.map(r => r.done))
        expect(settled.some(s => s.status === 'skipped')).toBe(true)
        expect(settled.some(s => s.status === 'completed')).toBe(true)
    })

    it('entity-shape replicate UPSERT is idempotent on postgres target', async () => {
        const srv = await getPipelineService()
        await srv.clear(CQN_REPLICATE)
        await srv.execute(CQN_REPLICATE, { mode: 'full', trigger: 'manual' })
        await srv.execute(CQN_REPLICATE, { mode: 'full', trigger: 'manual' })

        const rows = await SELECT.from('consumer.ReplicatedSourceOrders')
        expect(rows.length).toBe(7)
    })

    it('query-shape materialize aggregates with GROUP BY on postgres', async () => {
        const srv = await getPipelineService()
        const db = await cds.connect.to('db')
        await db.run(DELETE.from('consumer.DailyCustomerRevenue'))
        await srv.execute(CQN_MATERIALIZE, { mode: 'full', trigger: 'manual' })

        const rows = await SELECT.from('consumer.DailyCustomerRevenue')
        expect(rows.length).toBe(3)
    })

    it('partial refresh slice deletes matching rows before insert on postgres', async () => {
        const srv = await getPipelineService()
        const db = await cds.connect.to('db')
        await db.run(DELETE.from('consumer.DailyCustomerRevenue'))
        await INSERT.into('consumer.DailyCustomerRevenue').entries({
            customerId: 'C999',
            totalAmount: 999.99,
            orderCount: 42,
            lastActivity: new Date().toISOString(),
        })

        const seeded = await SELECT.from('consumer.DailyCustomerRevenue')
        expect(seeded.some(r => (r.customerId ?? r.customerid) === 'C999')).toBe(true)

        await srv.execute(CQN_PARTIAL, { mode: 'full', trigger: 'manual' })

        const rows = await SELECT.from('consumer.DailyCustomerRevenue')
        const c999 = rows.find(r => (r.customerId ?? r.customerid) === 'C999')
        expect(c999).toBeTruthy()
        expect(Number(c999.totalAmount ?? c999.totalamount)).toBe(999.99)

        const c001 = rows.find(r => (r.customerId ?? r.customerid) === 'C001')
        expect(c001).toBeTruthy()
        expect(Number(c001.totalAmount ?? c001.totalamount)).toBe(350.5)
    })

    it('tracker persists completed run on Pipelines and PipelineRuns', async () => {
        const srv = await getPipelineService()
        const { runId, done } = await srv.execute(CQN_REPLICATE, {
            mode: 'full',
            trigger: 'manual',
        })
        const result = await done
        expect(result.status).toBe('completed')

        const pipe = await SELECT.one.from('plugin_data_pipeline_Pipelines')
            .where({ name: CQN_REPLICATE })
        expect(pipe.status).toBe('idle')
        expect(pipe.lastSync ?? pipe.lastsync).toBeTruthy()

        const run = await SELECT.one.from('plugin_data_pipeline_PipelineRuns')
            .where({ ID: runId })
        expect(run.status).toBe('completed')
        expect(run.pipeline_name).toBe(CQN_REPLICATE)
    })
})
