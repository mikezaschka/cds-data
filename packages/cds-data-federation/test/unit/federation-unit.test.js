const cds = require('@sap/cds')

describe('Unit Tests', () => {

    const { expect } = cds.test(require('path').join(__dirname, '../fixtures/consumer'))

    // ─── Annotation scanner ────────────────────────────────────────────────────

    describe('Annotation scanner', () => {

        it('should detect @federation.delegate with segmented ref', () => {
            const { scanAnnotations } = require('../../srv/annotation-scanner')
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
            const { scanAnnotations } = require('../../srv/annotation-scanner')
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
            const { scanAnnotations } = require('../../srv/annotation-scanner')
            const def = {
                '@federation.replicate': true,
                projection: { from: { ref: ['Svc', 'Ent'] } }
            }
            scanAnnotations({ definitions: { 'Svc': { kind: 'service' }, 'MyService.MyEntity': def } })
            expect(def['@cds.persistence.table']).to.equal(true)
        })

        it('should keep derived read models as views over replicated tables', () => {
            const { scanAnnotations } = require('../../srv/annotation-scanner')
            const derived = {
                '@readonly': true,
                '@federation.replicate': true,
                '@cds.persistence.table': true,
                '@cds.persistence.skip': false,
                projection: {
                    from: { ref: ['travel.ReplicatedFlights'] },
                    columns: [{ ref: ['ID'] }, { ref: ['date'] }],
                    where: [{ ref: ['free_seats'] }, '>', { val: 0 }]
                }
            }
            const replicated = {
                '@federation.replicate': true,
                projection: { from: { ref: ['Remote', 'Flights'] } }
            }
            const { configs } = scanAnnotations({
                definitions: {
                    Remote: { kind: 'service' },
                    'travel.ReplicatedFlights': replicated,
                    'travel.AvailableFlights': derived
                }
            })
            expect(configs).to.have.length(1)
            expect(configs[0].entityFullName).to.equal('travel.ReplicatedFlights')
            expect(replicated['@cds.persistence.table']).to.equal(true)
            expect(derived['@cds.persistence.table']).to.equal(false)
            expect(derived).to.not.have.property('@cds.persistence.skip')
        })

        it('should resolve unqualified same-service refs for derived read models', () => {
            const { scanAnnotations } = require('../../srv/annotation-scanner')
            const derived = {
                '@readonly': true,
                '@federation.replicate.mode': 'full',
                '@cds.persistence.table': true,
                projection: {
                    from: { ref: ['ReplicatedFlights'] },
                    columns: [{ ref: ['ID'] }],
                    where: [{ ref: ['free_seats'] }, '>', { val: 0 }]
                }
            }
            const replicated = {
                '@federation.replicate': { mode: 'full' },
                projection: { from: { ref: ['Remote', 'Flights'] } }
            }
            const { configs } = scanAnnotations({
                definitions: {
                    Remote: { kind: 'service' },
                    'travel.TravelService.ReplicatedFlights': replicated,
                    'travel.TravelService.AvailableFlights': derived
                }
            })
            expect(configs).to.have.length(1)
            expect(configs[0].entityFullName).to.equal('travel.TravelService.ReplicatedFlights')
            expect(derived['@cds.persistence.table']).to.equal(false)
        })

        it('should extract options from @federation.delegate annotation value', () => {
            const { scanAnnotations } = require('../../srv/annotation-scanner')
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

        it('should extract renames from as select from (query.SELECT columns)', () => {
            const { scanAnnotations } = require('../../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    Remote: { kind: 'service' },
                    'Svc.Products': {
                        '@federation.delegate': true,
                        // CDS stores `as select from` under query.SELECT, not projection
                        query: {
                            SELECT: {
                                from: { ref: ['Remote', 'Products'] },
                                columns: [
                                    { ref: ['ProductID'], as: 'ID' },
                                    { ref: ['ProductName'], as: 'Name' },
                                    { ref: ['UnitsInStock'] },
                                    {
                                        as: 'LocalEntity',
                                        cast: {
                                            type: 'cds.Association',
                                            target: 'Svc.LocalEntity',
                                            on: [{ ref: ['$self'] }, '=', { ref: ['LocalEntity', 'Product'] }]
                                        }
                                    }
                                ]
                            }
                        }
                    }
                }
            })
            expect(configs).to.have.length(1)
            const { viewMapping } = configs[0]
            expect(viewMapping.isWildcard).to.equal(false)
            expect(viewMapping.localToRemote).to.deep.equal({
                ID: 'ProductID',
                Name: 'ProductName'
            })
            expect(viewMapping.remoteToLocal.ProductID).to.equal('ID')
            expect(viewMapping.remoteToLocal.ProductName).to.equal('Name')
            expect(viewMapping.projectedColumns).to.deep.equal([
                { ref: ['ProductID'], as: 'ID' },
                { ref: ['ProductName'], as: 'Name' },
                'UnitsInStock'
            ])
        })

        it('should extract options from @federation.replicate annotation value', () => {
            const { scanAnnotations } = require('../../srv/annotation-scanner')
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
            const { scanAnnotations } = require('../../srv/annotation-scanner')
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
            const { scanAnnotations } = require('../../srv/annotation-scanner')
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
            const { scanAnnotations } = require('../../srv/annotation-scanner')
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
            const { scanAnnotations } = require('../../srv/annotation-scanner')
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
            const { scanAnnotations } = require('../../srv/annotation-scanner')
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
            const { scanAnnotations } = require('../../srv/annotation-scanner')
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

        it('should carry inline preload: true through to options', () => {
            const { scanAnnotations } = require('../../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    'Remote': { kind: 'service' },
                    'Svc.Ent': {
                        '@federation.replicate': { schedule: 600000, preload: true },
                        projection: { from: { ref: ['Remote', 'Ent'] } }
                    }
                }
            })
            expect(configs[0].strategy).to.equal('replicate')
            expect(configs[0].options.preload).to.equal(true)
            expect(configs[0].options.mode).to.be.undefined
        })

        it('should not infer mode or delta from preload-only replicate options', () => {
            const { scanAnnotations } = require('../../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    'Remote': { kind: 'service' },
                    'Svc.Ent': {
                        '@federation.replicate': { preload: true },
                        projection: { from: { ref: ['Remote', 'Ent'] } }
                    }
                }
            })
            expect(configs[0].options).to.deep.equal({ preload: true })
        })

        it('should reconstruct flattened @federation.replicate.preload.* options', () => {
            const { scanAnnotations } = require('../../srv/annotation-scanner')
            const { configs } = scanAnnotations({
                definitions: {
                    'Remote': { kind: 'service' },
                    'Svc.Ent': {
                        '@federation.replicate.schedule': 600000,
                        '@federation.replicate.preload.mode': 'full',
                        '@federation.replicate.preload.wait': true,
                        projection: { from: { ref: ['Remote', 'Ent'] } }
                    }
                }
            })
            expect(configs[0].strategy).to.equal('replicate')
            expect(configs[0].options.preload).to.deep.equal({ mode: 'full', wait: true })
        })

        it('should prefer non-flattened annotation over flattened', () => {
            const { scanAnnotations } = require('../../srv/annotation-scanner')
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
            const { resolveWriteFlags } = require('../../srv/annotation-scanner')
            const flags = resolveWriteFlags({ writable: true })
            expect(flags).to.deep.equal({ create: true, update: true, delete: true })
        })

        it('should resolve individual create flag only', () => {
            const { resolveWriteFlags } = require('../../srv/annotation-scanner')
            const flags = resolveWriteFlags({ create: true })
            expect(flags).to.deep.equal({ create: true, update: false, delete: false })
        })

        it('should resolve writable with delete override', () => {
            const { resolveWriteFlags } = require('../../srv/annotation-scanner')
            const flags = resolveWriteFlags({ writable: true, delete: false })
            expect(flags).to.deep.equal({ create: true, update: true, delete: false })
        })

        it('should resolve no flags to all false', () => {
            const { resolveWriteFlags } = require('../../srv/annotation-scanner')
            const flags = resolveWriteFlags({})
            expect(flags).to.deep.equal({ create: false, update: false, delete: false })
        })

        it('should resolve writable: false to all false', () => {
            const { resolveWriteFlags } = require('../../srv/annotation-scanner')
            const flags = resolveWriteFlags({ writable: false })
            expect(flags).to.deep.equal({ create: false, update: false, delete: false })
        })

        it('should resolve individual flags with writable: false', () => {
            const { resolveWriteFlags } = require('../../srv/annotation-scanner')
            const flags = resolveWriteFlags({ writable: false, update: true })
            expect(flags).to.deep.equal({ create: false, update: true, delete: false })
        })

        it('should store writeFlags on config in scanAnnotations', () => {
            const { scanAnnotations } = require('../../srv/annotation-scanner')
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
            const { scanAnnotations } = require('../../srv/annotation-scanner')
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
            const { scanAnnotations } = require('../../srv/annotation-scanner')
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
            const { scanAnnotations } = require('../../srv/annotation-scanner')
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
            const { normalizeTags } = require('../../srv/delegation/handler-registration')
            const tags = normalizeTags('Products', {})
            expect(tags).to.deep.equal([{ value: 'federation:Products' }])
        })

        it('should normalize string tags to { value } format', () => {
            const { normalizeTags } = require('../../srv/delegation/handler-registration')
            const tags = normalizeTags('Products', { tags: ['product-cache', 'master-data'] })
            expect(tags).to.deep.equal([
                { value: 'federation:Products' },
                { value: 'product-cache' },
                { value: 'master-data' }
            ])
        })

        it('should pass through object tags unchanged', () => {
            const { normalizeTags } = require('../../srv/delegation/handler-registration')
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
            const { normalizeTags } = require('../../srv/delegation/handler-registration')
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
            const { normalizeTags } = require('../../srv/delegation/handler-registration')
            const tags = normalizeTags('Entity', { ttl: 5000 })
            expect(tags).to.deep.equal([{ value: 'federation:Entity' }])
        })

        it('should handle empty tags array', () => {
            const { normalizeTags } = require('../../srv/delegation/handler-registration')
            const tags = normalizeTags('Entity', { tags: [] })
            expect(tags).to.deep.equal([{ value: 'federation:Entity' }])
        })

        it('should auto-inject tenant template tag when multitenancy is active', () => {
            const cds = require('@sap/cds')
            const prior = cds.env.requires
            cds.env.requires = {
                ...prior,
                'cds-data-federation': { multitenancy: { active: true } },
            }
            const { normalizeTags } = require('../../srv/delegation/handler-registration')
            const tags = normalizeTags('Products', { ttl: 60000 })
            expect(tags).to.deep.include({ template: 'tenant-{{tenant}}-entity-{{entity}}' })
            cds.env.requires = prior
        })
    })

    describe('EntityCacheDbResolver', () => {
        it('should build distinct sqlite paths per tenant', () => {
            const cds = require('@sap/cds')
            const prior = cds.env.requires
            cds.env.requires = {
                ...prior,
                'cds-data-federation': {
                    entityCache: {
                        urlTemplate: 'cache-{tenant}.sqlite',
                        baseDir: '/tmp/fed-cache',
                    },
                },
            }
            const { getEntityCacheDbResolver } = require('../../srv/entity-cache/EntityCacheDbResolver')
            const resolver = getEntityCacheDbResolver()
            expect(resolver.resolveUrl('t1')).to.equal('/tmp/fed-cache/cache-t1.sqlite')
            expect(resolver.resolveUrl('t2')).to.equal('/tmp/fed-cache/cache-t2.sqlite')
            cds.env.requires = prior
        })

        it('should resolve static sqlite path', () => {
            const cds = require('@sap/cds')
            const prior = cds.env.requires
            cds.env.requires = {
                ...prior,
                'cds-data-federation': {
                    entityCache: {
                        staticUrlTemplate: 'shared-static.sqlite',
                        baseDir: '/tmp/fed-cache',
                    },
                },
            }
            const { getEntityCacheDbResolver } = require('../../srv/entity-cache/EntityCacheDbResolver')
            const resolver = getEntityCacheDbResolver()
            expect(resolver.resolveStaticUrl()).to.equal('/tmp/fed-cache/shared-static.sqlite')
            cds.env.requires = prior
        })
    })

    describe('EntityCacheRegistry', () => {
        it('should honour negative TTL as never-expiring once loaded', () => {
            const { getEntityCacheRegistry } = require('../../srv/entity-cache/EntityCacheRegistry')
            const { effectiveTtlMs } = require('../../srv/entity-cache/entity-cache-options')
            const registry = getEntityCacheRegistry()
            const tenant = '__ttl_test__'
            registry.invalidate('consumer.Products', tenant)
            expect(registry.isFresh('consumer.Products', tenant, effectiveTtlMs({ ttl: -1 }))).to.equal(false)
            registry.markFresh('consumer.Products', tenant, 100)
            expect(registry.isFresh('consumer.Products', tenant, effectiveTtlMs({ ttl: -1 }))).to.equal(true)
        })

        it('should pick LRU victim by touched timestamp', () => {
            const { getEntityCacheRegistry } = require('../../srv/entity-cache/EntityCacheRegistry')
            const registry = getEntityCacheRegistry()
            const tenant = '__lru_test__'
            registry.invalidate('consumer.A', tenant)
            registry.invalidate('consumer.B', tenant)
            registry.markFresh('consumer.A', tenant, 500)
            registry.markFresh('consumer.B', tenant, 500)
            registry.touch('consumer.B', tenant)
            expect(registry.leastRecentlyUsed(tenant)).to.equal('consumer.A')
        })

        it('should register group members', () => {
            const { getEntityCacheRegistry } = require('../../srv/entity-cache/EntityCacheRegistry')
            const registry = getEntityCacheRegistry()
            registry.registerConfig('consumer.Customers', { group: 'desk' })
            registry.registerConfig('consumer.Products', { group: 'desk' })
            expect(registry.groupMembers('desk').sort()).to.deep.equal(['consumer.Customers', 'consumer.Products'])
        })
    })

    describe('entity-cache-options', () => {
        it('should merge global and per-entity cache options', () => {
            const cds = require('@sap/cds')
            const prior = cds.env.requires
            cds.env.requires = {
                ...prior,
                'cds-data-federation': {
                    entityCache: { wait: true, validate: true, size: 999 },
                },
            }
            const { resolveEntityCacheOptions, cacheTenantKey } = require('../../srv/entity-cache/entity-cache-options')
            const resolved = resolveEntityCacheOptions({ ttl: 5000, wait: false, static: true })
            expect(resolved.ttl).to.equal(5000)
            expect(resolved.wait).to.equal(false)
            expect(resolved.static).to.equal(true)
            expect(resolved.size).to.equal(999)
            expect(cacheTenantKey('t1', true)).to.equal('__static__')
            cds.env.requires = prior
        })
    })
})
