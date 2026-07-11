const cds = require('@sap/cds')
const { startProvider, stopProvider, startInventoryProvider, stopInventoryProvider } = require('../../support/setup')

// Delegate Strategy — caching (via cds-caching)
//
// C1–C15: cache hit/miss, TTL expiration, renames, tag-based invalidation
// (static / auto-entity / dynamic), custom cache service, cache clear, `$expand` + cache.
// Requires `cds-caching` peer dependency.

describe('Delegate Strategy', () => {

    beforeAll(async () => {
        await Promise.all([startProvider(), startInventoryProvider()])
    }, 30000)

    const { GET, POST, PATCH, DELETE: DEL, expect } = cds.test(require('path').join(__dirname, '../../fixtures/consumer'))

    afterAll(async () => {
        await Promise.all([stopProvider(), stopInventoryProvider()])
    })

    describe('Caching (via cds-caching)', () => {
        const base = '/odata/v4/consumer'
        let cache, longTermCache

        beforeAll(async () => {
            cache = await cds.connect.to('caching')
            longTermCache = await cds.connect.to('longTermCache')
            await cache.setMetricsEnabled(true)
            await longTermCache.setMetricsEnabled(true)
        })

        beforeEach(async () => {
            await cache.clear()
            await cache.clearMetrics()
            await longTermCache.clear()
            await longTermCache.clearMetrics()
        })

        // ── Cache hit/miss ───────────────────────────────────────────────

        describe('Cache hit/miss', () => {

            it('[4.3.1] C1: should return data on first request (cache miss)', async () => {
                const { data } = await GET(`${base}/CachedCustomers`)
                expect(data.value).to.have.length(5)
                const metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(1)
                expect(metrics.hits).to.equal(0)
            })

            it('[4.3.1] C2: should return cached data on second identical request (cache hit)', async () => {
                await GET(`${base}/CachedCustomers`)
                const { data } = await GET(`${base}/CachedCustomers`)
                expect(data.value).to.have.length(5)
                const metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(1)
                expect(metrics.hits).to.equal(1)
            })

            it('[4.3.1] C3: should produce separate cache entries for different $filter', async () => {
                await GET(`${base}/CachedCustomers?$filter=city eq 'Berlin'`)
                await GET(`${base}/CachedCustomers?$filter=city eq 'Munich'`)
                const metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(2)
                expect(metrics.hits).to.equal(0)
            })

            it('[4.3.1] C4: should produce separate cache entries for different $select', async () => {
                await GET(`${base}/CachedCustomers?$select=ID,name`)
                await GET(`${base}/CachedCustomers?$select=ID,city`)
                const metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(2)
                expect(metrics.hits).to.equal(0)
            })
        })

        // ── TTL expiration ───────────────────────────────────────────────

        describe('TTL expiration', () => {

            it('[4.3.2] C5: should expire cached entries after TTL', async () => {
                await GET(`${base}/CachedCustomers`)
                let metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(1)

                await new Promise(resolve => setTimeout(resolve, 6000))

                await GET(`${base}/CachedCustomers`)
                metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(2)
                expect(metrics.hits).to.equal(0)
            }, 15000)
        })

        // ── Cache with consumption view renames ──────────────────────────

        describe('Cache with consumption view renames', () => {

            it('[4.3.1] C6: should cache responses with local field names', async () => {
                const { data: first } = await GET(`${base}/CachedProducts`)
                expect(first.value[0]).to.have.property('productId')
                expect(first.value[0]).to.have.property('productName')
                expect(first.value[0]).to.have.property('unitPrice')

                const { data: second } = await GET(`${base}/CachedProducts`)
                expect(second.value[0]).to.have.property('productId')
                expect(second.value[0]).to.have.property('productName')

                const metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(1)
                expect(metrics.hits).to.equal(1)
            })

            it('[4.3.1] C7: should serve cached response for $filter on renamed field', async () => {
                const { data: first } = await GET(`${base}/CachedProducts?$filter=unitPrice gt 100`)
                expect(first.value.length).to.be.greaterThan(0)
                first.value.forEach(p => expect(Number(p.unitPrice)).to.be.greaterThan(100))

                const { data: second } = await GET(`${base}/CachedProducts?$filter=unitPrice gt 100`)
                expect(second.value).to.deep.equal(first.value)

                const metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(1)
                expect(metrics.hits).to.equal(1)
            })
        })

        // ── Tag-based invalidation ───────────────────────────────────────

        describe('Tag-based invalidation', () => {

            it('[4.3.3] C8: should invalidate by custom static tag', async () => {
                await GET(`${base}/CachedProducts`)
                await GET(`${base}/CachedProducts`)
                let metrics = await cache.getCurrentMetrics()
                expect(metrics.hits).to.equal(1)

                await cache.deleteByTag('product-cache')

                await GET(`${base}/CachedProducts`)
                metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(2)
            })

            it('[4.3.3] C9: should invalidate by auto-generated entity tag', async () => {
                await GET(`${base}/CachedCustomers`)
                await GET(`${base}/CachedCustomers`)
                let metrics = await cache.getCurrentMetrics()
                expect(metrics.hits).to.equal(1)

                await cache.deleteByTag('federation:CachedCustomers')

                await GET(`${base}/CachedCustomers`)
                metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(2)
            })

            it('[4.3.3] C10: should not affect other entities when invalidating by tag', async () => {
                await GET(`${base}/CachedCustomers`)
                await GET(`${base}/CachedProducts`)

                await cache.deleteByTag('federation:CachedCustomers')

                await GET(`${base}/CachedCustomers`)
                await GET(`${base}/CachedProducts`)

                const metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(3)
                expect(metrics.hits).to.equal(1)
            })

            it('[4.3.3] C11: should support dynamic data-based tags', async () => {
                await GET(`${base}/CachedOrders`)
                await GET(`${base}/CachedOrders`)
                let metrics = await longTermCache.getCurrentMetrics()
                expect(metrics.hits).to.equal(1)

                await longTermCache.deleteByTag('order-O001')

                await GET(`${base}/CachedOrders`)
                metrics = await longTermCache.getCurrentMetrics()
                expect(metrics.misses).to.equal(2)
            })
        })

        // ── Custom cache service ─────────────────────────────────────────

        describe('Custom cache service', () => {

            it('[4.3.7] C12: should use named cache service from annotation', async () => {
                await GET(`${base}/CachedOrders`)

                const defaultMetrics = await cache.getCurrentMetrics()
                const ltMetrics = await longTermCache.getCurrentMetrics()
                expect(defaultMetrics.misses || 0).to.equal(0)
                expect(defaultMetrics.hits || 0).to.equal(0)
                expect(ltMetrics.misses).to.equal(1)
            })

            it('[4.3.7] C13: should isolate entries between cache services', async () => {
                await GET(`${base}/CachedCustomers`)
                await GET(`${base}/CachedOrders`)

                // cache.clear() resets both entries AND metrics for the cleared service
                await cache.clear()

                await GET(`${base}/CachedCustomers`)
                await GET(`${base}/CachedOrders`)

                const defaultMetrics = await cache.getCurrentMetrics()
                const ltMetrics = await longTermCache.getCurrentMetrics()
                // default cache was cleared → CachedCustomers re-fetched → 1 miss (post-clear)
                expect(defaultMetrics.misses).to.equal(1)
                expect(defaultMetrics.hits).to.equal(0)
                // longTermCache was NOT cleared → CachedOrders still cached → 1 hit
                expect(ltMetrics.misses).to.equal(1)
                expect(ltMetrics.hits).to.equal(1)
            })
        })

        // ── Cache clear ──────────────────────────────────────────────────

        describe('Cache clear', () => {

            it('[4.3.3] C14: should clear all cached entries for a service', async () => {
                await GET(`${base}/CachedCustomers`)
                await GET(`${base}/CachedProducts`)

                // cache.clear() resets both entries AND metrics
                await cache.clear()

                await GET(`${base}/CachedCustomers`)
                await GET(`${base}/CachedProducts`)

                const metrics = await cache.getCurrentMetrics()
                // Both re-fetched after clear → 2 misses (post-clear only)
                expect(metrics.misses).to.equal(2)
                expect(metrics.hits).to.equal(0)
            })
        })

        // ── $expand with cache ───────────────────────────────────────────

        describe('$expand with cache', () => {

            it('[4.3.1] C15: should cache Scenario A expand results', async () => {
                const { data: first } = await GET(`${base}/CachedOrders?$expand=buyer`)
                expect(first.value[0]).to.have.property('buyer')
                expect(first.value[0].buyer).to.have.property('name')

                const { data: second } = await GET(`${base}/CachedOrders?$expand=buyer`)
                expect(second.value[0].buyer).to.have.property('name')

                const metrics = await longTermCache.getCurrentMetrics()
                expect(metrics.misses).to.equal(1)
                expect(metrics.hits).to.equal(1)
            })
        })
    })

    describe('Entity-level SQLite cache (cache.strategy: entity)', () => {
        const base = '/odata/v4/consumer'
        const pipName = 'data-federation-cache:consumer.EntityCachedCustomers'

        const ecRunCount = async () => {
            const rows = await SELECT.from('plugin_data_pipeline_PipelineRuns')
            return rows.filter((r) => r.pipeline_name === pipName).length
        }

        it('[4.3.8] EC1: two different OData filters reuse one SQLite-backed sync until TTL expires', async () => {
            const start = await ecRunCount()

            const { data: berlin } = await GET(`${base}/EntityCachedCustomers?$filter=city eq 'Berlin'`)
            expect(berlin.value.length).to.be.greaterThan(0)

            const afterBerlin = await ecRunCount()
            expect(afterBerlin).to.equal(start + 1)

            const { data: munich } = await GET(`${base}/EntityCachedCustomers?$filter=city eq 'Munich'`)
            expect(munich.value.length).to.be.greaterThan(0)

            const finalCount = await ecRunCount()
            expect(finalCount).to.equal(afterBerlin)
        })
    })
})
