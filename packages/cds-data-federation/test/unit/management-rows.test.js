const cds = require('@sap/cds')
const FederationManagementService = require('../../srv/FederationManagementService')

/**
 * Row building and the degradation branches of the management API (ADR 0017).
 *
 * These run without a served app so the "other plugin is not there" cases are
 * reachable at all: in a fixture the pipeline's model is always present, which
 * would hide exactly the branch worth covering.
 */
describe('FederationManagementService rows (ADR 0017)', () => {

    let srv
    let servicesBackup

    beforeEach(() => {
        srv = new FederationManagementService('FederationManagementService')
        servicesBackup = cds.services
        cds.services = {}
    })

    afterEach(() => {
        cds.services = servicesBackup
    })

    const replicate = {
        entityName: 'ReplicatedCustomers',
        entityFullName: 'consumer.ReplicatedCustomers',
        strategy: 'replicate',
        serviceName: 'ConsumerService',
        sourceService: 'ProviderService',
        sourceEntity: 'Customers',
        options: { mode: 'delta' },
        viewMapping: {
            isWildcard: false,
            projectedColumns: ['ID', 'name'],
            localToRemote: { customerId: 'ID', name: 'name' },
            staticWhere: null,
        },
    }

    const cachedDelegate = {
        entityName: 'Airports',
        entityFullName: 'consumer.Airports',
        strategy: 'delegate',
        serviceName: 'ConsumerService',
        sourceService: 'ProviderService',
        sourceEntity: 'Airports',
        options: { cache: { strategy: 'response', ttl: 60000 } },
        viewMapping: { isWildcard: true, projectedColumns: [], localToRemote: {}, staticWhere: null },
    }

    describe('shape', () => {

        it('keys on the FQN and derives the short name from it', () => {
            const row = srv._toRow(replicate)
            expect(row.entity).toBe('consumer.ReplicatedCustomers')
            expect(row.name).toBe('ReplicatedCustomers')
        })

        it('reports only genuine renames, not identity mappings', () => {
            const row = srv._toRow(replicate)
            expect(row.renames).toEqual([{ local: 'customerId', remote: 'ID' }])
        })

        it('reports an empty column list for a wildcard projection', () => {
            const row = srv._toRow(cachedDelegate)
            expect(row.wildcardProjection).toBe(true)
            expect(row.projectedColumns).toEqual([])
        })

        it('marks a view with a static where as scoped', () => {
            const scoped = { ...replicate, viewMapping: { ...replicate.viewMapping, staticWhere: [{ ref: ['x'] }] } }
            expect(srv._toRow(scoped).scoped).toBe(true)
            expect(srv._toRow(replicate).scoped).toBe(false)
        })

        it('defaults to read-only and names the verbs when opted in', () => {
            expect(srv._toRow(replicate).writable).toBe(false)
            expect(srv._toRow(replicate).writeVerbs).toBe('')

            const writable = { ...replicate, options: { writable: true } }
            expect(srv._toRow(writable).writable).toBe(true)
            expect(srv._toRow(writable).writeVerbs).toBe('create,update,delete')

            const partial = { ...replicate, options: { create: true, update: true } }
            expect(srv._toRow(partial).writeVerbs).toBe('create,update')
        })

        it('carries the response-cache tag only for a response cache', () => {
            expect(srv._toRow(cachedDelegate).cacheTag).toBe('federation:Airports')
            expect(srv._toRow(replicate).cacheTag).toBeNull()
        })

        it('persists no run statistics or cache metrics', () => {
            // ADR 0017 §4 — reference, never copy.
            const row = srv._toRow(replicate)
            for (const forbidden of ['lastRun', 'statistics', 'hits', 'misses', 'hitRatio', 'runs']) {
                expect(row[forbidden]).toBeUndefined()
            }
        })
    })

    describe('degradation when another plugin is not there', () => {

        it('says why the pipeline detail is missing rather than showing a dead link', () => {
            cds.services = {
                'data-pipeline': { pipelineForEntity: () => ({ name: 'ReplicatedCustomers' }) },
                // no DataPipelineManagementService
            }
            const row = srv._toRow(replicate)
            expect(row.pipeline).toBe('ReplicatedCustomers')
            expect(row.pipelineDetail).toBeNull()
            expect(row.pipelineDetailUnavailable).toContain('management.reuse.api')
        })

        it('links to the pipeline when its API is served, at the path it actually uses', () => {
            cds.services = {
                'data-pipeline': { pipelineForEntity: () => ({ name: 'ReplicatedCustomers' }) },
                DataPipelineManagementService: { path: '/ops/pipeline' },
            }
            const row = srv._toRow(replicate)
            expect(row.pipelineDetail).toBe("/ops/pipeline/Pipelines('ReplicatedCustomers')")
            expect(row.pipelineDetailUnavailable).toBeNull()
        })

        it('reports no pipeline at all for an uncached delegate', () => {
            const plain = { ...cachedDelegate, options: {} }
            const row = srv._toRow(plain)
            expect(row.pipeline).toBeNull()
            expect(row.pipelineDetail).toBeNull()
            // Nothing is unavailable — there is simply nothing to link to.
            expect(row.pipelineDetailUnavailable).toBeNull()
        })

        it('says why cache metrics are missing when the caching API is off', () => {
            const row = srv._toRow(cachedDelegate)
            expect(row.cacheDetail).toBeNull()
            expect(row.cacheDetailUnavailable).toContain('metrics.reuse.api')
        })

        it('links cache metrics filtered to this entity\'s tag when served', () => {
            cds.services = { 'plugin.cds_caching.CachingApiService': { path: '/odata/v4/caching-api' } }
            const row = srv._toRow(cachedDelegate)
            expect(row.cacheDetail).toContain('/odata/v4/caching-api/TagMetrics')
            // Fully encoded: a half-encoded query string (escaped value, raw
            // spaces around `eq`) is rejected by the OData parser.
            expect(row.cacheDetail).toContain(encodeURIComponent("tag eq 'federation:Airports'"))
            expect(row.cacheDetail).not.toContain(' ')
        })

        it('survives the engine being absent entirely', () => {
            // A delegate-only app need not have cds-data-pipeline connected.
            const row = srv._toRow(replicate)
            expect(row.pipeline).toBeNull()
            expect(row.entity).toBe('consumer.ReplicatedCustomers')
        })
    })
})
