#!/usr/bin/env node
/**
 * sync-requirements-progress.js
 *
 * Single source of truth for requirement/test bookkeeping:
 *
 *   1. Parses `spec/reference/requirements.md`, finds every section table
 *      (4.1, 4.2, ...) and counts the status column.
 *   2. Regenerates the "### Progress Summary" table in that same file.
 *   3. Emits `spec/reference/test-mapping.md` — a generated index from
 *      requirement ID to the tests tagged `it('[<id>] ...')`.
 *
 * Idempotent. Safe to run from a pre-commit hook or from
 * `.claude/commands/update-requirements.md` Phase 3.
 *
 * Usage:
 *   node scripts/sync-requirements-progress.js
 *   node scripts/sync-requirements-progress.js --check   # exit 1 if diff
 */

const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '..')
const REQ_FILE = path.join(REPO, 'spec/reference/requirements.md')
const TEST_MAP_FILE = path.join(REPO, 'spec/reference/test-mapping.md')
const TEST_ROOTS = [
    path.join(REPO, 'packages/cds-data-pipeline/test'),
    path.join(REPO, 'packages/cds-data-federation/test'),
]

// ---------------------------------------------------------------------------
// Short titles for the Progress Summary table. Section numbers that are not
// listed fall back to the full heading text.
// ---------------------------------------------------------------------------
const SECTION_SHORT_TITLES = {
    1: 'Consumption Views',
    2: 'Delegate Strategy',
    3: 'Caching',
    4: 'Replicate Strategy',
    5: 'Annotation Config',
    6: 'Source Adapters',
    7: 'Data Transformation',
    8: 'Scheduling & Triggers',
    9: 'CQL Safety',
    10: 'Resilience',
    11: 'Observability',
    12: 'Security',
    13: 'Management API',
    14: 'Configuration',
    15: 'Multi-Tenancy',
    16: 'Example Apps',
}

// ---------------------------------------------------------------------------
// Status classification.
// ---------------------------------------------------------------------------
function idCompare(a, b) {
    const parse = id => {
        const parts = id.split('.')
        return parts.map(p => {
            const m = /^(\d+)([a-z]*)$/.exec(p)
            return m ? [parseInt(m[1], 10), m[2]] : [0, p]
        })
    }
    const pa = parse(a), pb = parse(b)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const [na, sa] = pa[i] ?? [0, '']
        const [nb, sb] = pb[i] ?? [0, '']
        if (na !== nb) return na - nb
        if (sa !== sb) return sa < sb ? -1 : 1
    }
    return 0
}

function classify(statusCell) {
    const s = statusCell.trim()
    if (/^Implemented\b/i.test(s)) return 'done'
    if (/^In progress\b/i.test(s)) return 'in_progress'
    if (/^Not started\b/i.test(s)) return 'not_started'
    if (/^Not supported\b/i.test(s)) return 'na'
    if (/^Removed\b/i.test(s)) return 'na'
    if (/^--$/.test(s)) return 'na'
    if (/^Expected to work\b/i.test(s)) return 'done'
    return null
}

// ---------------------------------------------------------------------------
// Parse the requirements file: return [{ section, minor, id, status, line }]
// plus the section-title map.
// ---------------------------------------------------------------------------
function parseRequirements(src) {
    const lines = src.split('\n')
    const rows = []
    const sectionTitles = {} // 1..16 → full heading text (minus "4.N ")
    const sectionHeader = /^### 4\.(\d+)\s+(.+)$/
    const rowMatch = /^\|\s+4\.(\d+)\.(\d+)([a-z]?)\s+\|(.+)\|\s*$/

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const h = sectionHeader.exec(line)
        if (h) {
            sectionTitles[parseInt(h[1], 10)] = h[2].trim()
            continue
        }
        const r = rowMatch.exec(line)
        if (!r) continue
        const section = parseInt(r[1], 10)
        const minor = `${r[2]}${r[3]}`
        // Everything between the first pipe after the ID and the trailing pipe.
        // Split on " | " (requirement rows use that separator consistently).
        const cells = r[4].split('|').map(c => c.trim())
        // cells: [feature, priority, status] (and maybe more if escaped pipes)
        const status = cells[cells.length - 1]
        const id = `4.${r[1]}.${minor}`
        rows.push({ section, minor, id, status, line: i + 1 })
    }
    return { rows, sectionTitles }
}

// ---------------------------------------------------------------------------
// Build the Progress Summary table text block.
// ---------------------------------------------------------------------------
function buildProgressTable(rows, sectionTitles) {
    const perSection = new Map()
    for (const r of rows) {
        if (!perSection.has(r.section)) {
            perSection.set(r.section, { total: 0, done: 0, in_progress: 0, not_started: 0, na: 0, unknown: [] })
        }
        const bucket = perSection.get(r.section)
        bucket.total++
        const cls = classify(r.status)
        if (cls) bucket[cls]++
        else bucket.unknown.push(r)
    }

    const sections = [...perSection.keys()].sort((a, b) => a - b)
    const lines = []
    lines.push('| Section | Total | Done | In Progress | Not Started | N/A |')
    lines.push('|---|---|---|---|---|---|')

    const totals = { total: 0, done: 0, in_progress: 0, not_started: 0, na: 0 }
    for (const s of sections) {
        const b = perSection.get(s)
        const title = SECTION_SHORT_TITLES[s] || sectionTitles[s] || `Section ${s}`
        lines.push(`| 4.${s} ${title} | ${b.total} | ${b.done} | ${b.in_progress} | ${b.not_started} | ${b.na} |`)
        totals.total += b.total
        totals.done += b.done
        totals.in_progress += b.in_progress
        totals.not_started += b.not_started
        totals.na += b.na
    }
    lines.push(`| **Total** | **${totals.total}** | **${totals.done}** | **${totals.in_progress}** | **${totals.not_started}** | **${totals.na}** |`)

    // Report unknown statuses so they get fixed in the source.
    const unknowns = [...perSection.values()].flatMap(b => b.unknown)
    if (unknowns.length) {
        console.error(`warning: ${unknowns.length} rows have an unrecognised status; they were counted as 0:`)
        for (const u of unknowns) console.error(`  - ${u.id} (line ${u.line}): ${u.status}`)
    }

    return { table: lines.join('\n'), totals, perSection }
}

// ---------------------------------------------------------------------------
// Rewrite the `### Progress Summary` block in requirements.md.
// The replaced region runs from the heading line through the `**Total**` row.
// ---------------------------------------------------------------------------
function rewriteProgressSummary(src, newTable) {
    const lines = src.split('\n')
    let startIdx = -1
    let endIdx = -1
    for (let i = 0; i < lines.length; i++) {
        if (startIdx === -1 && /^### Progress Summary\s*$/.test(lines[i])) {
            startIdx = i
            continue
        }
        if (startIdx !== -1 && /^\|\s*\*\*Total\*\*/.test(lines[i])) {
            endIdx = i
            break
        }
    }
    if (startIdx === -1 || endIdx === -1) {
        throw new Error('could not locate the Progress Summary block in requirements.md')
    }
    const before = lines.slice(0, startIdx + 1).join('\n')
    const after = lines.slice(endIdx + 1).join('\n')
    return `${before}\n\n${newTable}\n${after}`
}

// ---------------------------------------------------------------------------
// Test-mapping: walk test/, extract `it('[<id>] ...')` tags.
// ---------------------------------------------------------------------------
function walkTestFiles(dir) {
    const out = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            if (entry.name === 'fixtures' || entry.name === 'consumer') continue
            out.push(...walkTestFiles(p))
        } else if (/\.test\.js$/.test(entry.name)) {
            out.push(p)
        }
    }
    return out
}

function extractTaggedTests() {
    const files = TEST_ROOTS.flatMap(root => walkTestFiles(root))
    // id → Array<{ file: relPath, name: string }>
    const byId = new Map()
    const itRegex = /\bit\s*\(\s*['"`]\[(\d+\.\d+(?:\.\d+[a-z]?)?)\]\s*([^'"`]+)['"`]/g
    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8')
        const rel = path.relative(REPO, file)
        let m
        while ((m = itRegex.exec(src)) !== null) {
            const id = m[1]
            const name = `[${id}] ${m[2].trim()}`
            if (!byId.has(id)) byId.set(id, [])
            byId.get(id).push({ file: rel, name })
        }
    }
    return byId
}

function buildTestMappingDoc(byId, reqRows) {
    const rowById = new Map(reqRows.map(r => [r.id, r]))
    const lines = []
    lines.push('<!-- Generated by scripts/sync-requirements-progress.js. Do not edit by hand. -->')
    lines.push('')
    lines.push('# Test Mapping')
    lines.push('')
    lines.push('Auto-generated index of tests tagged with requirement IDs. Run `npm run sync:requirements` to refresh.')
    lines.push('')
    lines.push('Tests adopt the convention `it(\'[<id>] ...\')`. Only tests that map 1:1 to a requirement are tagged; plumbing/setup tests are left untagged.')
    lines.push('')
    lines.push('See [`spec/reference/requirements.md`](./requirements.md) for the requirement definitions.')
    lines.push('')
    lines.push('## Requirements with at least one tagged test')
    lines.push('')
    lines.push('| Requirement | Status | Tagged tests |')
    lines.push('|---|---|---|')
    const sortedIds = [...byId.keys()].sort(idCompare)
    for (const id of sortedIds) {
        const entries = byId.get(id)
        const req = rowById.get(id)
        const status = req ? req.status : '(requirement row not found)'
        lines.push(`| ${id} | ${status} | ${entries.length} |`)
    }
    lines.push('')
    lines.push('## Details')
    lines.push('')
    for (const id of sortedIds) {
        const entries = byId.get(id)
        const req = rowById.get(id)
        lines.push(`### ${id}`)
        lines.push('')
        if (req) {
            lines.push(`Status: **${req.status}**`)
        } else {
            lines.push('Status: _(no matching row in requirements.md)_')
        }
        lines.push('')
        for (const e of entries) {
            lines.push(`- \`${e.file}\` — ${e.name}`)
        }
        lines.push('')
    }

    // Requirements without any tagged tests → help find coverage gaps.
    const tagged = new Set(byId.keys())
    const untagged = reqRows.filter(r => !tagged.has(r.id) && classify(r.status) === 'done')
    if (untagged.length) {
        lines.push('## Implemented requirements without tagged tests')
        lines.push('')
        lines.push('These rows are marked `Implemented` but no test carries the `[<id>]` prefix. Either the tests exist and should be retagged, or coverage is thin.')
        lines.push('')
        for (const r of untagged) {
            lines.push(`- ${r.id} — ${r.status}`)
        }
        lines.push('')
    }
    return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
function main() {
    const checkOnly = process.argv.includes('--check')

    const reqSrc = fs.readFileSync(REQ_FILE, 'utf8')
    const { rows, sectionTitles } = parseRequirements(reqSrc)
    const { table, totals } = buildProgressTable(rows, sectionTitles)
    const newReqSrc = rewriteProgressSummary(reqSrc, table)

    const byId = extractTaggedTests()
    const mappingDoc = buildTestMappingDoc(byId, rows)

    let dirty = false
    if (newReqSrc !== reqSrc) {
        dirty = true
        if (!checkOnly) fs.writeFileSync(REQ_FILE, newReqSrc)
    }
    const existingMapping = fs.existsSync(TEST_MAP_FILE) ? fs.readFileSync(TEST_MAP_FILE, 'utf8') : ''
    const newMapping = mappingDoc.endsWith('\n') ? mappingDoc : mappingDoc + '\n'
    if (newMapping !== existingMapping) {
        dirty = true
        if (!checkOnly) fs.writeFileSync(TEST_MAP_FILE, newMapping)
    }

    const totalTagged = [...byId.values()].reduce((n, arr) => n + arr.length, 0)
    console.log(`Progress Summary: ${rows.length} rows | ${totals.done} Done | ${totals.in_progress} In Progress | ${totals.not_started} Not Started | ${totals.na} N/A`)
    console.log(`Test mapping: ${byId.size} requirement IDs covered across ${totalTagged} tagged tests`)
    if (checkOnly && dirty) {
        console.error('Generated files are stale. Run `npm run sync:requirements`.')
        process.exit(1)
    }
    if (!checkOnly && dirty) console.log('Updated: spec/reference/requirements.md and spec/reference/test-mapping.md')
    if (!dirty) console.log('No changes.')
}

main()
