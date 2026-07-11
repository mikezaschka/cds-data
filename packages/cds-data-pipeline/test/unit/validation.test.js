const path = require('path')
const cds = require('@sap/cds')
const BaseTargetAdapter = require('../../srv/adapters/targets/BaseTargetAdapter')

const { waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

class NoUpsertTarget extends BaseTargetAdapter {
    capabilities() {
        return {
            batchInsert: true,
            keyAddressableUpsert: false,
            batchDelete: true,
            truncate: true,
        }
    }
    async writeBatch() { return {} }
    async truncate() {}
    async deleteSlice() {}
}

class NoTruncateTarget extends BaseTargetAdapter {
    capabilities() {
        return {
            batchInsert: true,
            keyAddressableUpsert: true,
            batchDelete: false,
            truncate: false,
        }
    }
    async writeBatch() { return {} }
    async truncate() {}
    async deleteSlice() {}
}

class NoBatchInsertTarget extends BaseTargetAdapter {
    capabilities() {
        return {
            batchInsert: false,
            keyAddressableUpsert: true,
            batchDelete: true,
            truncate: true,
        }
    }
    async writeBatch() { return {} }
    async truncate() {}
    async deleteSlice() {}
}

describe('DataPipelineService.addPipeline validation', () => {
    cds.test(consumerRoot)
    beforeAll(waitForConsumerFixturePipelines)

    async function getSrv() {
        const srv = await cds.connect.to('data-pipeline')
        if (!srv) throw new Error('no pipeline service')
        return srv
    }

    async function expectThrow(fn) {
        let caught
        try {
            await fn()
        } catch (e) {
            caught = e
        }
        if (!caught) throw new Error('expected throw')
        return caught
    }

    it('row 1: rejects ambiguous source shape (query + entity)', async () => {
        const srv = await getSrv()
        const err = await expectThrow(() => srv.addPipeline({
            name: `__v_amb_${Date.now()}`,
            source: {
                service: 'db',
                entity: 'consumer.SourceOrders',
                query: () => SELECT.from('consumer.SourceOrders'),
            },
            target: { entity: 'consumer.DailyCustomerRevenue' },
        }))
        expect(err.message).toMatch(/ambiguous source shape/)
        expect(err.message).toMatch(/inference/)
    })

    it('row 2: rejects missing source shape', async () => {
        const srv = await getSrv()
        const err = await expectThrow(() => srv.addPipeline({
            name: `__v_miss_${Date.now()}`,
            source: { service: 'ProviderService' },
            target: { entity: 'consumer.ReplicatedCustomers' },
        }))
        expect(err.message).toMatch(/missing source shape/)
    })

    it("row 3: rejects query-shape + mode 'delta'", async () => {
        const srv = await getSrv()
        const err = await expectThrow(() => srv.addPipeline({
            name: `__v_qd_${Date.now()}`,
            source: {
                kind: 'cqn',
                service: 'db',
                query: () => SELECT.from('consumer.SourceOrders'),
            },
            target: { entity: 'consumer.DailyCustomerRevenue' },
            mode: 'delta',
        }))
        expect(err.message).toMatch(/row-delta requires entity-shape/)
    })

    for (const mode of ['timestamp', 'key', 'datetime-fields']) {
        it(`row 4: rejects query-shape + delta.mode '${mode}'`, async () => {
            const srv = await getSrv()
            const err = await expectThrow(() => srv.addPipeline({
                name: `__v_qdm_${mode}_${Date.now()}`,
                source: {
                    kind: 'cqn',
                    service: 'db',
                    query: () => SELECT.from('consumer.SourceOrders'),
                },
                target: { entity: 'consumer.DailyCustomerRevenue' },
                delta: { mode },
            }))
            expect(err.message).toMatch(new RegExp(`delta\\.mode '${mode}' requires entity-shape`))
        })
    }

    it('[4.6.3] row 5: rejects partial refresh without refresh.slice', async () => {
        const srv = await getSrv()
        const err = await expectThrow(() => srv.addPipeline({
            name: `__v_part_${Date.now()}`,
            source: {
                kind: 'cqn',
                service: 'db',
                query: () => SELECT.from('consumer.SourceOrders'),
            },
            target: { entity: 'consumer.DailyCustomerRevenue' },
            refresh: { mode: 'partial' },
        }))
        expect(err.message).toMatch(/refresh\.slice/)
    })

    it('row 6: rejects delta when target lacks keyAddressableUpsert', async () => {
        const srv = await getSrv()
        const err = await expectThrow(() => srv.addPipeline({
            name: `__v_cap6_${Date.now()}`,
            source: { service: 'ProviderService', entity: 'Customers' },
            target: { entity: 'consumer.ReplicatedCustomers', adapter: NoUpsertTarget },
            mode: 'delta',
        }))
        expect(err.message).toMatch(/keyAddressableUpsert/)
    })

    it('row 7: rejects full mode when target cannot truncate or batch-delete', async () => {
        const srv = await getSrv()
        const err = await expectThrow(() => srv.addPipeline({
            name: `__v_cap7_${Date.now()}`,
            source: { service: 'ProviderService', entity: 'Customers' },
            target: { entity: 'consumer.ReplicatedCustomers', adapter: NoTruncateTarget },
            mode: 'full',
        }))
        expect(err.message).toMatch(/truncate or batch-delete/)
    })

    it('row 8: rejects query-shape when target lacks batchInsert', async () => {
        const srv = await getSrv()
        const err = await expectThrow(() => srv.addPipeline({
            name: `__v_cap8_${Date.now()}`,
            source: {
                kind: 'cqn',
                service: 'db',
                query: () => SELECT.from('consumer.SourceOrders'),
            },
            target: { entity: 'consumer.DailyCustomerRevenue', adapter: NoBatchInsertTarget },
        }))
        expect(err.message).toMatch(/batchInsert/)
    })

    it('row 9: rejects source.origin with source.query', async () => {
        const srv = await getSrv()
        const err = await expectThrow(() => srv.addPipeline({
            name: `__v_o9_${Date.now()}`,
            source: {
                kind: 'cqn',
                service: 'db',
                origin: 'X',
                query: () => SELECT.from('consumer.SourceOrders'),
            },
            target: { entity: 'consumer.DailyCustomerRevenue' },
        }))
        expect(err.message).toMatch(/source\.origin is not supported with source\.query/)
        expect(err.message).toMatch(/multi-source/)
    })

    it('row 10: rejects source.origin without sourced target aspect', async () => {
        const srv = await getSrv()
        const err = await expectThrow(() => srv.addPipeline({
            name: `__v_o10_${Date.now()}`,
            source: { service: 'ProviderService', entity: 'Customers', origin: 'Z' },
            target: { entity: 'consumer.ReplicatedCustomers' },
        }))
        expect(err.message).toMatch(/plugin\.data_pipeline\.sourced/)
    })

    it('rejects unknown source.kind', async () => {
        const srv = await getSrv()
        const err = await expectThrow(() => srv.addPipeline({
            name: `__v_sk_${Date.now()}`,
            source: { service: 'ProviderService', entity: 'Customers', kind: 'graphql' },
            target: { entity: 'consumer.ReplicatedCustomers' },
        }))
        expect(err.message).toMatch(/unknown source\.kind/)
    })
})
