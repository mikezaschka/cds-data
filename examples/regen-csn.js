#!/usr/bin/env node
/**
 * Regenerates CSN snapshots under examples/consumer/srv/external/.
 *
 * For each source app + service, compiles the CDS model and writes a CSN file
 * containing only the selected service's definitions (both the `service` entry
 * and its projected entities). This is what the consumer imports via `using`.
 *
 * Run with: node examples/regen-csn.js
 */
const cds = require('@sap/cds')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'examples/consumer/srv/external')

const SOURCES = [
    {
        model: 'examples/provider',
        service: 'ProviderService',
        outFile: 'ProviderService.csn'
    },
    {
        model: 'examples/provider',
        service: 'LicensingService',
        outFile: 'LicensingService.csn'
    },
    {
        model: 'examples/inventory',
        service: 'StreamingService',
        outFile: 'StreamingService.csn'
    }
]

async function main() {
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })

    for (const src of SOURCES) {
        const modelRoot = path.join(ROOT, src.model)
        // cds.load wants globs/dirs; pass the app's db + srv folders explicitly.
        const csn = await cds.load([
            path.join(modelRoot, 'db'),
            path.join(modelRoot, 'srv')
        ])

        // Transitively collect every definition reachable from the target
        // service: the service itself, its entities, the namespace entities
        // those projections point at (and their own references), and any types
        // referenced as association targets.
        const wanted = new Set([src.service])
        for (const [name, def] of Object.entries(csn.definitions)) {
            if (name.startsWith(src.service + '.') && def.kind === 'entity') {
                wanted.add(name)
            }
        }

        const walk = () => {
            let grew = false
            for (const name of [...wanted]) {
                const def = csn.definitions[name]
                if (!def) continue
                const refs = []
                const fromRef = def.projection?.from?.ref || def.query?.SELECT?.from?.ref
                if (fromRef) refs.push(fromRef.join('.'))
                for (const el of Object.values(def.elements || {})) {
                    if (el.target) refs.push(el.target)
                    if (el.type && el.type !== 'cds.Association' && el.type !== 'cds.Composition'
                        && !el.type.startsWith('cds.')) refs.push(el.type)
                }
                for (const r of refs) {
                    if (csn.definitions[r] && !wanted.has(r)) {
                        wanted.add(r)
                        grew = true
                    }
                }
            }
            return grew
        }
        while (walk()) { /* fixpoint */ }

        const filtered = { definitions: {} }
        for (const name of wanted) {
            if (csn.definitions[name]) filtered.definitions[name] = csn.definitions[name]
        }

        if (!filtered.definitions[src.service]) {
            throw new Error(`Service '${src.service}' not found in ${src.model}`)
        }

        const outPath = path.join(OUT, src.outFile)
        fs.writeFileSync(outPath, JSON.stringify(filtered, null, 2) + '\n')
        // eslint-disable-next-line no-console
        console.log(`Wrote ${path.relative(ROOT, outPath)} (${Object.keys(filtered.definitions).length} definitions)`)
    }
}

main().catch(err => {
    // eslint-disable-next-line no-console
    console.error(err)
    process.exit(1)
})
