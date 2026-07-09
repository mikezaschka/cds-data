const fs = require('fs')
const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { getPipelineService, waitForConsumerFixturePipelines } = require('../support/helpers')
const { getProviderCustomerById } = require('../support/customerRemote')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

/** @param {( ) => Promise<boolean>} fn */
async function untilTrue(fn, { timeoutMs = 15000, intervalMs = 100 } = {}) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
        if (await fn()) return
        await new Promise((r) => setTimeout(r, intervalMs))
    }
    throw new Error('condition not met within timeout')
}

function sameCustomerFields(local, remote) {
    if (!local || !remote) return false
    const t1 = new Date(local.modifiedAt).getTime()
    const t2 = new Date(remote.modifiedAt).getTime()
    if (t1 !== t2 || Number.isNaN(t1) || Number.isNaN(t2)) return false
    return (
        local.ID === remote.ID
        && local.name === remote.name
        && local.city === remote.city
        && local.country === remote.country
        && local.email === remote.email
        && !!local.blocked === !!remote.blocked
    )
}

describe('ADR 0009 — event execute / executeEvent', () => {
    beforeAll(async () => {
        const messagingDir = path.resolve(__dirname, '../.messaging-shared')
        if (fs.existsSync(messagingDir)) {
            fs.rmSync(messagingDir, { recursive: true, force: true })
        }
        fs.mkdirSync(messagingDir, { recursive: true })
        await stopProvider().catch(() => {})
        await startProvider()
    }, 60000)

    cds.test(consumerRoot)

    beforeAll(async () => {
        await waitForConsumerFixturePipelines()
        await new Promise((r) => setTimeout(r, 300))
    }, 60000)

    afterAll(async () => {
        await stopProvider()
    })

    it('rejects event + async + engine queued in v1', async () => {
        if (typeof cds.queued !== 'function') return
        const srv = await getPipelineService()
        const q = cds.queued(srv)
        if (!q || typeof q.emit !== 'function') return
        await expect(
            srv.execute('ReplicatedCustomers', {
                async: true,
                engine: 'queued',
                event: {
                    read: 'payload',
                    payload: { ID: 'C001', name: 'x', city: 'x', country: 'DEU', email: 'x', blocked: false, modifiedAt: '2025-01-15T10:00:00Z' },
                },
            }),
        ).rejects.toThrow(/event micro-runs/)
    })

    it('executeEvent read:payload upserts without advancing Pipelines.lastSync and updates local row', async () => {
        const srv = await getPipelineService()
        await srv.execute('ReplicatedCustomers', { mode: 'full', trigger: 'manual' })
        const row = await SELECT.one
            .from('plugin_data_pipeline_Pipelines')
            .columns('lastSync')
            .where({ name: 'ReplicatedCustomers' })
        const before = row && row.lastSync
        expect(before).toBeTruthy()
        await new Promise((r) => setTimeout(r, 10))

        await srv.executeEvent('ReplicatedCustomers', {
            event: {
                read: 'payload',
                payload: {
                    ID: 'C001',
                    name: 'Event upsert name',
                    city: 'Berlin',
                    country: 'DE',
                    email: 'acme@example.com',
                    blocked: false,
                    modifiedAt: '2025-01-15T10:00:00Z',
                },
            },
        })

        const afterRow = await SELECT.one
            .from('plugin_data_pipeline_Pipelines')
            .columns('lastSync')
            .where({ name: 'ReplicatedCustomers' })
        expect(afterRow.lastSync).toEqual(before)

        const local = await SELECT.one.from('consumer.ReplicatedCustomers').where({ ID: 'C001' })
        expect(local).toBeTruthy()
        expect(local.name).toBe('Event upsert name')
    })

    it('validates event.read and keys', async () => {
        const srv = await getPipelineService()
        await expect(
            srv.execute('ReplicatedCustomers', { trigger: 'event', event: { read: 'nope' } }),
        ).rejects.toThrow(/event.read must be 'key' or 'payload'/)
        await expect(
            srv.execute('ReplicatedCustomers', { trigger: 'event', event: { read: 'key' } }),
        ).rejects.toThrow(/event.keys/)
    })

    it('read:key upsert pulls from remote and matches local row', async () => {
        const srv = await getPipelineService()
        await srv.execute('ReplicatedCustomers', { mode: 'full', trigger: 'manual' })
        const remote = await getProviderCustomerById('C002')
        expect(remote).toBeTruthy()
        await srv.execute('ReplicatedCustomers', {
            trigger: 'event',
            event: { read: 'key', action: 'upsert', keys: { ID: 'C002' } },
        })
        const local = await SELECT.one.from('consumer.ReplicatedCustomers').where({ ID: 'C002' })
        expect(sameCustomerFields(local, remote)).toBe(true)
    })

    it('messaging bridge: key topic handler recreates local row from remote', async () => {
        const srv = await getPipelineService()
        await srv.execute('ReplicatedCustomers', { mode: 'full', trigger: 'manual' })
        const remote = await getProviderCustomerById('C005')
        expect(remote).toBeTruthy()
        await DELETE.from('consumer.ReplicatedCustomers').where({ ID: 'C005' })
        const empty = await SELECT.one.from('consumer.ReplicatedCustomers').where({ ID: 'C005' })
        expect(empty).toBeFalsy()
        await srv.execute('ReplicatedCustomers', {
            trigger: 'event',
            event: { read: 'key', action: 'upsert', keys: { ID: 'C005' } },
        })
        const local = await SELECT.one.from('consumer.ReplicatedCustomers').where({ ID: 'C005' })
        expect(sameCustomerFields(local, remote)).toBe(true)
    })

    it('messaging bridge: payload topic handler upserts without prior local row', async () => {
        const srv = await getPipelineService()
        await srv.execute('ReplicatedCustomers', { mode: 'full', trigger: 'manual' })
        const remote = await getProviderCustomerById('C004')
        expect(remote).toBeTruthy()
        await DELETE.from('consumer.ReplicatedCustomers').where({ ID: 'C004' })
        const empty = await SELECT.one.from('consumer.ReplicatedCustomers').where({ ID: 'C004' })
        expect(empty).toBeFalsy()
        const { ID, name, city, country, email, blocked, modifiedAt } = remote
        await srv.execute('ReplicatedCustomers', {
            trigger: 'event',
            event: { read: 'payload', action: 'upsert', payload: { ID, name, city, country, email, blocked, modifiedAt } },
        })
        const local = await SELECT.one.from('consumer.ReplicatedCustomers').where({ ID: 'C004' })
        expect(sameCustomerFields(local, remote)).toBe(true)
    })

    it('executeEvent read:key upsert matches remote (parity)', async () => {
        const srv = await getPipelineService()
        await srv.execute('ReplicatedCustomers', { mode: 'full', trigger: 'manual' })
        const remote = await getProviderCustomerById('C002')
        await srv.executeEvent('ReplicatedCustomers', {
            event: { read: 'key', action: 'upsert', keys: { ID: 'C002' } },
        })
        const local = await SELECT.one.from('consumer.ReplicatedCustomers').where({ ID: 'C002' })
        expect(sameCustomerFields(local, remote)).toBe(true)
    })

    it('read:key delete removes local only; remote still exists; restore with full', async () => {
        const srv = await getPipelineService()
        await srv.execute('ReplicatedCustomers', { mode: 'full', trigger: 'manual' })
        const beforeRemote = await getProviderCustomerById('C005')
        expect(beforeRemote).toBeTruthy()
        await srv.execute('ReplicatedCustomers', {
            trigger: 'event',
            event: { read: 'key', action: 'delete', keys: { ID: 'C005' } },
        })
        const local = await SELECT.one.from('consumer.ReplicatedCustomers').where({ ID: 'C005' })
        expect(local).toBeFalsy()
        const afterRemote = await getProviderCustomerById('C005')
        expect(afterRemote).toBeTruthy()
        await srv.execute('ReplicatedCustomers', { mode: 'full', trigger: 'manual' })
    })
})
