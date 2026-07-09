import { describe, expect, it, vi } from 'vitest'

// Transpile-free copy of the timestamp rules under test (keep in sync with Formatters.ts).
function toTimestamp(value) {
    if (value == null || value === '') return null
    if (value instanceof Date) {
        const time = value.getTime()
        return Number.isNaN(time) ? null : time
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null
        return Math.abs(value) < 1e12 ? value * 1000 : value
    }
    const text = String(value).trim()
    const v2Match = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(text)
    if (v2Match) {
        const ticks = Number(v2Match[1])
        return Number.isFinite(ticks) ? ticks : null
    }
    if (/^\d+$/.test(text)) {
        const numeric = Number(text)
        const time = text.length <= 10 ? numeric * 1000 : numeric
        return Number.isFinite(time) ? time : null
    }
    const time = new Date(text).getTime()
    return Number.isNaN(time) ? null : time
}

function formatTimestamp(value) {
    const time = toTimestamp(value)
    if (time == null) return ''
    return new Date(time).toISOString()
}

function formatRelativeTime(value) {
    const time = toTimestamp(value)
    if (time == null) return ''
    const diffMs = Date.now() - time
    if (diffMs < -60_000) return formatTimestamp(value)
    const seconds = Math.round(Math.max(0, diffMs) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.round(minutes / 60)
    if (hours < 48) return `${hours}h ago`
    const days = Math.round(hours / 24)
    return `${days}d ago`
}

describe('formatRelativeTime', () => {
    it('treats numeric unix seconds as seconds, not milliseconds', () => {
        const seconds = 1783528438
        expect(toTimestamp(seconds)).toBe(1783528438000)
    })

    it('falls back to absolute time when the timestamp is in the future', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-06-08T12:00:00.000Z'))
        const iso = '2026-07-08T16:33:58.430Z'
        expect(formatRelativeTime(iso)).toBe(iso)
        vi.useRealTimers()
    })

    it('parses OData V2 /Date(ms)/ strings', () => {
        const ms = new Date('2026-07-08T16:33:58.430Z').getTime()
        expect(toTimestamp(`/Date(${ms})/`)).toBe(ms)
    })
})
