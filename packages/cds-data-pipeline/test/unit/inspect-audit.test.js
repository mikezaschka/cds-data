// @vitest-environment node
const cds = require('@sap/cds')
const { auditSensitiveRead } = require('../../srv/lib/inspectAudit')

describe('inspectAudit', () => {
    const originalRequires = cds.env.requires
    const originalModel = cds.model

    afterEach(() => {
        cds.env.requires = originalRequires
        cds.model = originalModel
        vi.restoreAllMocks()
    })

    it('is a no-op when audit-log is not configured', async () => {
        cds.env.requires = { ...originalRequires }
        delete cds.env.requires['audit-log']
        await expect(
            auditSensitiveRead('consumer.ReplicatedCustomers', ['name']),
        ).resolves.toBeUndefined()
    })

    it('emits SensitiveDataRead for sensitive columns when audit-log is configured', async () => {
        cds.model = {
            definitions: {
                'consumer.ReplicatedCustomers': {
                    kind: 'entity',
                    elements: {
                        ID: {},
                        name: { '@PersonalData.IsPotentiallySensitive': true },
                        city: {},
                    },
                },
            },
        }
        const log = vi.fn()
        cds.env.requires = {
            ...originalRequires,
            'audit-log': { kind: 'mock' },
        }
        vi.spyOn(cds.connect, 'to').mockResolvedValue({ log })

        await auditSensitiveRead('consumer.ReplicatedCustomers', ['ID', 'name', 'city'])

        expect(log).toHaveBeenCalledWith('SensitiveDataRead', expect.objectContaining({
            object: { type: 'consumer.ReplicatedCustomers' },
            attributes: [{ name: 'name' }],
        }))
    })
})
