// @vitest-environment node
const { resolvePolicy, purgeRunsForPipeline } = require('../../srv/lib/housekeeping')
const { getHousekeepingConfig, normalizeHousekeepingBlock } = require('../../lib/config-normalizer')

describe('housekeeping resolvePolicy', () => {
    it('merges per-pipeline overrides onto global defaults', () => {
        const global = { enabled: true, retentionDays: 90, maxRuns: 1000 }
        expect(resolvePolicy({ maxRuns: 50 }, global)).toEqual({
            enabled: true,
            retentionDays: 90,
            maxRuns: 50,
        })
    })

    it('uses pipeline-only values when global is disabled', () => {
        expect(resolvePolicy({ retentionDays: 30 }, { enabled: false })).toEqual({
            enabled: true,
            retentionDays: 30,
            maxRuns: undefined,
        })
    })

    it('returns disabled when neither axis is set', () => {
        expect(resolvePolicy({}, { enabled: true })).toEqual({
            enabled: false,
            retentionDays: undefined,
            maxRuns: undefined,
        })
    })
})

describe('getHousekeepingConfig', () => {
    it('returns disabled when no housekeeping block is configured', () => {
        expect(getHousekeepingConfig({})).toEqual({ enabled: false })
    })

    it('reads retention defaults from datapipeline requires entry', () => {
        expect(getHousekeepingConfig({
            datapipeline: {
                impl: 'cds-data-pipeline',
                housekeeping: {
                    retentionDays: 90,
                    maxRuns: 500,
                },
            },
        })).toEqual({
            enabled: true,
            retentionDays: 90,
            maxRuns: 500,
            schedule: { every: 86400000, engine: 'spawn' },
        })
    })

    it('ignores housekeeping blocks without retention axes', () => {
        expect(normalizeHousekeepingBlock({ schedule: '0 3 * * *' })).toEqual({ enabled: false })
    })
})
