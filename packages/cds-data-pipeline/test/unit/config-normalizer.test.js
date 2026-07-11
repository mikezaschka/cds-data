// @vitest-environment node
const { normalizePipelineConfig, getPipelineRequiresEntries } = require('../../lib/config-normalizer')

describe('config-normalizer', () => {
    it('normalizes management.reuse flags', () => {
        const normalized = normalizePipelineConfig({
            impl: 'cds-data-pipeline',
            management: {
                reuse: {
                    api: true,
                    console: false,
                },
            },
        })

        expect(normalized.reuse.api).toBe(true)
        expect(normalized.reuse.console).toBe(false)
        expect(normalized.management.reuse.api).toBe(true)
    })

    it('console reuse implies api reuse', () => {
        const normalized = normalizePipelineConfig({
            impl: 'cds-data-pipeline',
            management: {
                reuse: {
                    console: true,
                },
            },
        })

        expect(normalized.reuse.api).toBe(true)
        expect(normalized.reuse.console).toBe(true)
    })

    it('collects data-pipeline requires entries by impl', () => {
        const entries = getPipelineRequiresEntries({
            db: { kind: 'sqlite' },
            'data-pipeline': {
                impl: 'cds-data-pipeline',
                management: { reuse: { api: true } },
            },
            other: { impl: 'something-else' },
        })

        expect(entries).toHaveLength(1)
        expect(entries[0].name).toBe('data-pipeline')
        expect(entries[0].normalized.reuse.api).toBe(true)
    })

    it('normalizes management.inspect flag (default true)', () => {
        const enabled = normalizePipelineConfig({
            impl: 'cds-data-pipeline',
            management: { reuse: { api: true } },
        })
        expect(enabled.inspect).toBe(true)
        expect(enabled.management.inspect).toBe(true)

        const disabled = normalizePipelineConfig({
            impl: 'cds-data-pipeline',
            management: { inspect: false, reuse: { api: true } },
        })
        expect(disabled.inspect).toBe(false)
        expect(disabled.management.inspect).toBe(false)
    })

    it('[4.13.7] isManagementInspectEnabled respects inspect opt-out', () => {
        const { isManagementInspectEnabled } = require('../../lib/config-normalizer')
        expect(isManagementInspectEnabled({})).toBe(true)
        expect(isManagementInspectEnabled({
            'data-pipeline': {
                impl: 'cds-data-pipeline',
                management: { inspect: false },
            },
        })).toBe(false)
        expect(isManagementInspectEnabled({
            'data-pipeline': {
                impl: 'cds-data-pipeline',
                management: { inspect: true, reuse: { api: true } },
            },
        })).toBe(true)
    })

    it('[4.13.9] normalizes housekeeping retention defaults', () => {
        const { getHousekeepingConfig } = require('../../lib/config-normalizer')
        expect(getHousekeepingConfig({
            'data-pipeline': {
                impl: 'cds-data-pipeline',
                housekeeping: { retentionDays: 30 },
            },
        })).toMatchObject({
            enabled: true,
            retentionDays: 30,
            schedule: { every: 86400000, engine: 'spawn' },
        })
    })
})
