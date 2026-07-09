const {
    validateOverridesPatch,
    clearOverrideKeys,
    applyOverrides,
    serializeBaseConfig,
    parseOverridesJson,
    buildConfigView,
    deepMerge,
} = require('../../srv/lib/overrides')

describe('overrides helpers', () => {
    it('rejects non-overridable top-level keys', () => {
        expect(() => validateOverridesPatch({ viewMapping: {} })).toThrow(/not overridable/)
        expect(() => validateOverridesPatch({ target: {} })).toThrow(/not overridable/)
        expect(() => validateOverridesPatch({ source: { entity: 'X' } })).toThrow(/source\.entity/)
    })

    it('accepts allowlisted knobs', () => {
        const cleaned = validateOverridesPatch({
            mode: 'full',
            enabled: false,
            source: { batchSize: 50, delay: 10 },
            delta: { mode: 'key', field: 'ID' },
            description: 'ops override',
            flags: { entityCacheRefreshTruncate: true },
            schedule: { every: 5000, engine: 'spawn' },
        })
        expect(cleaned.mode).toBe('full')
        expect(cleaned.enabled).toBe(false)
        expect(cleaned.source.batchSize).toBe(50)
        expect(cleaned.delta.mode).toBe('key')
    })

    it('applyOverrides preserves closures from base', () => {
        const query = () => ({})
        const base = {
            name: 'P',
            mode: 'delta',
            source: { service: 'S', entity: 'E', query, batchSize: 1000 },
            schedule: { every: 60000, engine: 'spawn' },
        }
        const eff = applyOverrides(base, { mode: 'full', source: { batchSize: 10 }, schedule: null })
        expect(eff.mode).toBe('full')
        expect(eff.source.batchSize).toBe(10)
        expect(eff.source.query).toBe(query)
        expect(eff.source.service).toBe('S')
        expect(eff.schedule).toBeUndefined()
        expect(eff.enabled).toBe(true)
    })

    it('clearOverrideKeys removes nested paths', () => {
        const next = clearOverrideKeys(
            { mode: 'full', source: { batchSize: 10, delay: 5 }, delta: { mode: 'key' } },
            ['source.batchSize', 'delta'],
        )
        expect(next.mode).toBe('full')
        expect(next.source).toEqual({ delay: 5 })
        expect(next.delta).toBeUndefined()
    })

    it('serializeBaseConfig strips query / adapters', () => {
        const ser = serializeBaseConfig({
            name: 'P',
            mode: 'delta',
            source: { service: 'S', entity: 'E', query: () => 1, adapter: class X {} },
            target: { entity: 'T', adapter: class Y {} },
            schedule: { every: 1000, engine: 'spawn' },
        })
        expect(ser.source.query).toBeUndefined()
        expect(ser.source.adapter).toBeUndefined()
        expect(ser.target.adapter).toBeUndefined()
        expect(ser.enabled).toBe(true)
    })

    it('parseOverridesJson tolerates bad JSON', () => {
        expect(parseOverridesJson(null)).toEqual({})
        expect(parseOverridesJson('{')).toEqual({})
        expect(parseOverridesJson('{"mode":"full"}')).toEqual({ mode: 'full' })
    })

    it('buildConfigView marks overridden fields', () => {
        const base = {
            name: 'P',
            mode: 'delta',
            enabled: true,
            source: { batchSize: 1000, delay: 0, maxRetries: 3, retryDelay: 1000 },
            delta: { mode: 'timestamp', field: 'modifiedAt' },
        }
        const overrides = { mode: 'full', source: { batchSize: 100 } }
        const effective = applyOverrides(base, overrides)
        const view = buildConfigView({
            baseConfig: base,
            overrides,
            effectiveConfig: effective,
            scheduleLiveChangeSupported: true,
        })
        const modeField = view.fields.find((f) => f.path === 'mode')
        expect(modeField.source).toBe('override')
        expect(modeField.coded).toBe('delta')
        expect(modeField.override).toBe('full')
        expect(modeField.effective).toBe('full')
        const batch = view.fields.find((f) => f.path === 'source.batchSize')
        expect(batch.source).toBe('override')
        expect(batch.effective).toBe(100)
        expect(view.meta.scheduleLiveChangeSupported).toBe(true)
    })

    it('deepMerge nests objects', () => {
        expect(deepMerge({ a: 1, b: { c: 2 } }, { b: { d: 3 } })).toEqual({ a: 1, b: { c: 2, d: 3 } })
    })
})
