const { runInTenantContext } = require('../../srv/lib/tenant-context')
const {
    listTenants,
    resolveTenantExecuteOpts,
    runForAllTenants,
    setTenantListProvider,
} = require('../../srv/lib/TenantRunCoordinator')

describe('TenantRunCoordinator', () => {
    const cds = require('@sap/cds')

    afterEach(() => {
        setTenantListProvider(null)
        delete cds.env.requires['cds-data-federation']
        delete cds.env.requires['cds-data-pipeline']
    })

    it('[4.15.1] lists configured tenant ids from federation multitenancy config', async () => {
        cds.env.requires['cds-data-federation'] = {
            multitenancy: { tenantIds: ['t1', 't2'] },
        }
        await expect(listTenants()).resolves.toEqual(['t1', 't2'])
    })

    it('[4.15.2] merges per-tenant replicate overrides into execute opts', () => {
        cds.env.requires['cds-data-federation'] = {
            multitenancy: {
                tenants: {
                    t1: { replicate: { Movies: { mode: 'full' } } },
                    t2: { replicate: { Movies: { mode: 'delta' } } },
                },
            },
        }
        expect(resolveTenantExecuteOpts('t1', 'Movies', { trigger: 'scheduled' })).toEqual({
            trigger: 'scheduled',
            mode: 'full',
        })
        expect(resolveTenantExecuteOpts('t2', 'Movies', { trigger: 'scheduled' })).toEqual({
            trigger: 'scheduled',
            mode: 'delta',
        })
    })

    it('[4.15.1] runForAllTenants executes once per tenant', async () => {
        setTenantListProvider(async () => ['a', 'b'])
        const calls = []
        const mockSrv = {
            execute: vi.fn(async (name, opts) => {
                calls.push({ tenant: opts?.tenant, name, opts })
                return { runId: 'r1', name }
            }),
        }
        await runForAllTenants(mockSrv, 'pip1', { trigger: 'scheduled' })
        expect(mockSrv.execute).toHaveBeenCalledTimes(2)
        expect(calls.map((c) => c.tenant).sort()).toEqual(['a', 'b'])
    })
})

describe('runInTenantContext', () => {
    it('sets entity-cache tenant for the callback', async () => {
        const { currentEntityCacheTenant } = require('../../srv/lib/entity-cache-tenant')
        let seen
        await runInTenantContext('t99', async () => {
            seen = currentEntityCacheTenant()
        })
        expect(seen).toBe('t99')
    })
})
