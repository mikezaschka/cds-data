const cds = require('@sap/cds')

describe('Unit Tests', () => {

    const { expect } = cds.test(__dirname + '/consumer/')

    // ─── Retry utility ─────────────────────────────────────────────────────────

    describe('Retry utility', () => {

        it('should retry on transient errors and succeed', async () => {
            const { withRetry } = require('../srv/lib/retry')
            let attempts = 0
            const result = await withRetry(
                () => {
                    attempts++
                    if (attempts < 3) throw new Error('Transient error')
                    return 'success'
                },
                { maxRetries: 3, baseDelay: 10 }
            )
            expect(result).to.equal('success')
            expect(attempts).to.equal(3)
        })

        it('should not retry when retryOn returns false', async () => {
            const { withRetry } = require('../srv/lib/retry')
            let attempts = 0
            try {
                await withRetry(
                    () => {
                        attempts++
                        const err = new Error('Not Found')
                        err.status = 404
                        throw err
                    },
                    {
                        maxRetries: 3,
                        baseDelay: 10,
                        retryOn: (err) => !err.status || err.status >= 500
                    }
                )
            } catch (err) {
                expect(err.message).to.equal('Not Found')
            }
            expect(attempts).to.equal(1)
        })

        it('should throw after max retries exhausted', async () => {
            const { withRetry } = require('../srv/lib/retry')
            let attempts = 0
            try {
                await withRetry(
                    () => { attempts++; throw new Error('Always fails') },
                    { maxRetries: 2, baseDelay: 10 }
                )
                expect.fail('Should have thrown')
            } catch (err) {
                expect(err.message).to.equal('Always fails')
            }
            expect(attempts).to.equal(3)
        })
    })

    // ─── Annotation scanner ────────────────────────────────────────────────────

    describe('Annotation scanner', () => {

        it('should detect @federation.delegate with segmented ref', () => {
            const { scanAnnotations } = require('../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    'RemoteService': { kind: 'service' },
                    'AppService.TestEntity': {
                        '@federation.delegate': true,
                        projection: { from: { ref: ['RemoteService', 'Entity'] } }
                    }
                }
            })
            expect(configs).to.have.length(1)
            expect(configs[0].sourceService).to.equal('RemoteService')
            expect(configs[0].sourceEntity).to.equal('Entity')
            expect(configs[0].strategy).to.equal('delegate')
        })

        it('should detect @federation.replicate with dot-separated ref', () => {
            const { scanAnnotations } = require('../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    'RemoteService': { kind: 'service' },
                    'AppService.TestEntity': {
                        '@federation.replicate': true,
                        projection: { from: { ref: ['RemoteService.Entity'] } }
                    }
                }
            })
            expect(configs[0].strategy).to.equal('replicate')
            expect(configs[0].sourceService).to.equal('RemoteService')
            expect(configs[0].sourceEntity).to.equal('Entity')
        })

        it('should set persistence flags for @federation.replicate', () => {
            const { scanAnnotations } = require('../srv/annotation-scanner')
            const def = {
                '@federation.replicate': true,
                projection: { from: { ref: ['Svc', 'Ent'] } }
            }
            scanAnnotations({ definitions: { 'Svc': { kind: 'service' }, 'MyService.MyEntity': def } })
            expect(def['@cds.persistence.table']).to.equal(true)
        })

        it('should extract options from @federation.delegate annotation value', () => {
            const { scanAnnotations } = require('../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    'Remote': { kind: 'service' },
                    'Svc.Ent': {
                        '@federation.delegate': { cache: { ttl: 30000 } },
                        projection: { from: { ref: ['Remote', 'Ent'] } }
                    }
                }
            })
            expect(configs[0].strategy).to.equal('delegate')
            expect(configs[0].options.cache).to.deep.equal({ ttl: 30000 })
        })

        it('should extract options from @federation.replicate annotation value', () => {
            const { scanAnnotations } = require('../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    'Remote': { kind: 'service' },
                    'Svc.Ent': {
                        '@federation.replicate': { mode: 'delta', schedule: '*/10 * * * *' },
                        projection: { from: { ref: ['Remote', 'Ent'] } }
                    }
                }
            })
            expect(configs[0].strategy).to.equal('replicate')
            expect(configs[0].options.mode).to.equal('delta')
            expect(configs[0].options.schedule).to.equal('*/10 * * * *')
        })

        it('should skip entities without projection source', () => {
            const { scanAnnotations } = require('../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    'Svc.Ent': {
                        '@federation.delegate': true
                        // no projection
                    }
                }
            })
            expect(configs).to.have.length(0)
        })

        it('should skip entities whose source is not a service', () => {
            const { scanAnnotations } = require('../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    'localNamespace': { kind: 'entity' },
                    'Svc.Ent': {
                        '@federation.delegate': true,
                        projection: { from: { ref: ['localNamespace', 'Something'] } }
                    }
                }
            })
            expect(configs).to.have.length(0)
        })

        it('should ignore entities without @federation annotations', () => {
            const { scanAnnotations } = require('../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    'Remote': { kind: 'service' },
                    'Svc.Ent': {
                        projection: { from: { ref: ['Remote', 'Ent'] } }
                    }
                }
            })
            expect(configs).to.have.length(0)
        })

        it('should detect flattened @federation.delegate.cache.* annotations', () => {
            const { scanAnnotations } = require('../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    'Remote': { kind: 'service' },
                    'Svc.Ent': {
                        '@federation.delegate.cache.ttl': 5000,
                        '@federation.delegate.cache.tags': ['product-cache'],
                        projection: { from: { ref: ['Remote', 'Ent'] } }
                    }
                }
            })
            expect(configs).to.have.length(1)
            expect(configs[0].strategy).to.equal('delegate')
            expect(configs[0].options.cache.ttl).to.equal(5000)
            expect(configs[0].options.cache.tags).to.deep.equal(['product-cache'])
        })

        it('should detect flattened @federation.delegate.cache.service annotation', () => {
            const { scanAnnotations } = require('../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    'Remote': { kind: 'service' },
                    'Svc.Ent': {
                        '@federation.delegate.cache.ttl': 10000,
                        '@federation.delegate.cache.service': 'longTermCache',
                        '@federation.delegate.cache.tags': [{ data: 'orderId', prefix: 'order-' }],
                        projection: { from: { ref: ['Remote', 'Ent'] } }
                    }
                }
            })
            expect(configs[0].options.cache.service).to.equal('longTermCache')
            expect(configs[0].options.cache.tags).to.deep.equal([{ data: 'orderId', prefix: 'order-' }])
        })

        it('should detect flattened @federation.replicate.* annotations', () => {
            const { scanAnnotations } = require('../srv/annotation-scanner')
            const def = {
                '@federation.replicate.mode': 'delta',
                '@federation.replicate.schedule': '*/10 * * * *',
                projection: { from: { ref: ['Remote', 'Ent'] } }
            }
            const { configs } = scanAnnotations({
                definitions: { 'Remote': { kind: 'service' }, 'Svc.Ent': def }
            })
            expect(configs[0].strategy).to.equal('replicate')
            expect(configs[0].options.mode).to.equal('delta')
            expect(configs[0].options.schedule).to.equal('*/10 * * * *')
        })

        it('should prefer non-flattened annotation over flattened', () => {
            const { scanAnnotations } = require('../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    'Remote': { kind: 'service' },
                    'Svc.Ent': {
                        '@federation.delegate': { cache: { ttl: 9999 } },
                        '@federation.delegate.cache.ttl': 1111,
                        projection: { from: { ref: ['Remote', 'Ent'] } }
                    }
                }
            })
            expect(configs[0].options.cache.ttl).to.equal(9999)
        })
    })

    // ─── Write flags resolution ──────────────────────────────────────────────

    describe('Write flags resolution', () => {

        it('should resolve writable: true to all flags true', () => {
            const { resolveWriteFlags } = require('../srv/annotation-scanner')
            const flags = resolveWriteFlags({ writable: true })
            expect(flags).to.deep.equal({ create: true, update: true, delete: true })
        })

        it('should resolve individual create flag only', () => {
            const { resolveWriteFlags } = require('../srv/annotation-scanner')
            const flags = resolveWriteFlags({ create: true })
            expect(flags).to.deep.equal({ create: true, update: false, delete: false })
        })

        it('should resolve writable with delete override', () => {
            const { resolveWriteFlags } = require('../srv/annotation-scanner')
            const flags = resolveWriteFlags({ writable: true, delete: false })
            expect(flags).to.deep.equal({ create: true, update: true, delete: false })
        })

        it('should resolve no flags to all false', () => {
            const { resolveWriteFlags } = require('../srv/annotation-scanner')
            const flags = resolveWriteFlags({})
            expect(flags).to.deep.equal({ create: false, update: false, delete: false })
        })

        it('should resolve writable: false to all false', () => {
            const { resolveWriteFlags } = require('../srv/annotation-scanner')
            const flags = resolveWriteFlags({ writable: false })
            expect(flags).to.deep.equal({ create: false, update: false, delete: false })
        })

        it('should resolve individual flags with writable: false', () => {
            const { resolveWriteFlags } = require('../srv/annotation-scanner')
            const flags = resolveWriteFlags({ writable: false, update: true })
            expect(flags).to.deep.equal({ create: false, update: true, delete: false })
        })

        it('should store writeFlags on config in scanAnnotations', () => {
            const { scanAnnotations } = require('../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    'Remote': { kind: 'service' },
                    'Svc.Ent': {
                        '@federation.delegate': { writable: true },
                        projection: { from: { ref: ['Remote', 'Ent'] } }
                    }
                }
            })
            expect(configs[0].writeFlags).to.deep.equal({ create: true, update: true, delete: true })
        })

        it('should store writeFlags for selective flags', () => {
            const { scanAnnotations } = require('../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    'Remote': { kind: 'service' },
                    'Svc.Ent': {
                        '@federation.delegate': { create: true, update: true },
                        projection: { from: { ref: ['Remote', 'Ent'] } }
                    }
                }
            })
            expect(configs[0].writeFlags).to.deep.equal({ create: true, update: true, delete: false })
        })

        it('should strip @readonly only when write flags are enabled', () => {
            const { scanAnnotations } = require('../srv/annotation-scanner')
            const writableDef = {
                '@federation.delegate': { writable: true },
                '@readonly': true,
                projection: { from: { ref: ['Remote', 'Ent'] } }
            }
            const readonlyDef = {
                '@federation.delegate': true,
                '@readonly': true,
                projection: { from: { ref: ['Remote', 'Ent2'] } }
            }
            scanAnnotations({
                definitions: {
                    'Remote': { kind: 'service' },
                    'Svc.Writable': writableDef,
                    'Svc.Readonly': readonlyDef
                }
            })
            expect(writableDef).to.not.have.property('@readonly')
            expect(readonlyDef).to.have.property('@readonly', true)
        })

        it('should resolve flattened writable annotation', () => {
            const { scanAnnotations } = require('../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    'Remote': { kind: 'service' },
                    'Svc.Ent': {
                        '@federation.delegate.writable': true,
                        projection: { from: { ref: ['Remote', 'Ent'] } }
                    }
                }
            })
            expect(configs[0].writeFlags).to.deep.equal({ create: true, update: true, delete: true })
        })
    })

    // ─── Tag normalization ──────────────────────────────────────────────────

    describe('Tag normalization', () => {

        it('should auto-generate federation:<entityName> tag', () => {
            const { normalizeTags } = require('../srv/delegation/handler-registration')
            const tags = normalizeTags('Products', {})
            expect(tags).to.deep.equal([{ value: 'federation:Products' }])
        })

        it('should normalize string tags to { value } format', () => {
            const { normalizeTags } = require('../srv/delegation/handler-registration')
            const tags = normalizeTags('Products', { tags: ['product-cache', 'master-data'] })
            expect(tags).to.deep.equal([
                { value: 'federation:Products' },
                { value: 'product-cache' },
                { value: 'master-data' }
            ])
        })

        it('should pass through object tags unchanged', () => {
            const { normalizeTags } = require('../srv/delegation/handler-registration')
            const tags = normalizeTags('Orders', {
                tags: [
                    { data: 'orderId', prefix: 'order-' },
                    { value: 'order-data' },
                    { template: 'tenant-{tenant}' }
                ]
            })
            expect(tags).to.deep.equal([
                { value: 'federation:Orders' },
                { data: 'orderId', prefix: 'order-' },
                { value: 'order-data' },
                { template: 'tenant-{tenant}' }
            ])
        })

        it('should handle mixed string and object tags', () => {
            const { normalizeTags } = require('../srv/delegation/handler-registration')
            const tags = normalizeTags('Items', {
                tags: ['static-tag', { data: 'itemId', prefix: 'item-' }]
            })
            expect(tags).to.deep.equal([
                { value: 'federation:Items' },
                { value: 'static-tag' },
                { data: 'itemId', prefix: 'item-' }
            ])
        })

        it('should handle undefined tags gracefully', () => {
            const { normalizeTags } = require('../srv/delegation/handler-registration')
            const tags = normalizeTags('Entity', { ttl: 5000 })
            expect(tags).to.deep.equal([{ value: 'federation:Entity' }])
        })

        it('should handle empty tags array', () => {
            const { normalizeTags } = require('../srv/delegation/handler-registration')
            const tags = normalizeTags('Entity', { tags: [] })
            expect(tags).to.deep.equal([{ value: 'federation:Entity' }])
        })
    })
})
