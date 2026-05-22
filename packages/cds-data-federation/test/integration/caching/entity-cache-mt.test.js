const fs = require('fs')
const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../../support/setup')

describe('Entity cache — per-tenant SQLite (ADR 0010)', () => {
    const cacheDir = path.join(__dirname, '../../fixtures/consumer-ec-mt/.entity-cache-mt')
    const base = '/odata/v4/consumer'

    beforeAll(async () => {
        if (fs.existsSync(cacheDir)) {
            for (const f of fs.readdirSync(cacheDir)) {
                if (f.endsWith('.sqlite')) fs.unlinkSync(path.join(cacheDir, f))
            }
        } else {
            fs.mkdirSync(cacheDir, { recursive: true })
        }
        await startProvider()
    }, 30000)

    const { GET, expect } = cds.test('.')

    afterAll(async () => {
        await stopProvider()
    })

    it('[4.3.8] EC2: separate SQLite files per tenant with isolated cache rows', async () => {
        const { getEntityCacheDbResolver } = require('../../../srv/entity-cache/EntityCacheDbResolver')
        const resolver = getEntityCacheDbResolver()

        const t1Url = resolver.resolveUrl('t1')
        const t2Url = resolver.resolveUrl('t2')
        expect(t1Url).not.to.equal(t2Url)

        const { data: data1 } = await GET(`${base}/EntityCachedCustomers`, { auth: { username: 'alice', password: '' } })
        expect(data1.value.length).to.be.greaterThan(0)
        expect(fs.existsSync(t1Url)).to.equal(true)

        const { data: data2 } = await GET(`${base}/EntityCachedCustomers`, { auth: { username: 'erin', password: '' } })
        expect(data2.value.length).to.be.greaterThan(0)
        expect(fs.existsSync(t2Url)).to.equal(true)

        const db1 = await resolver.connect('t1')
        const db2 = await resolver.connect('t2')
        const storageEntity = 'plugin.data_federation.entity_cache.EC_consumer_EntityCachedCustomers'
        const rows1 = await db1.run(SELECT.from(storageEntity))
        const rows2 = await db2.run(SELECT.from(storageEntity))
        expect(rows1.length).to.be.greaterThan(0)
        expect(rows2.length).to.be.greaterThan(0)
        expect(t1Url).not.to.equal(t2Url)
    }, 60000)
})
