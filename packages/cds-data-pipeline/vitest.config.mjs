import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootCds = path.join(__dirname, '../../node_modules/@sap/cds')

// Alias `@sap/cds` to the hoisted root copy so npm-workspaces / `file:` installs
// never resolve a second, nested `@sap/cds` (no `cds.db`, separate EventEmitter).
const alias = [
    { find: /^@sap\/cds$/, replacement: rootCds },
    { find: /^@sap\/cds\/(.*)$/, replacement: `${rootCds}/$1` },
]

/**
 * Run messaging-heavy integration last so earlier suites cannot leave scheduled
 * ticks or a torn-down provider interfering with event-execute polls. Ports the
 * former Jest `test-sequencer.js`.
 */
class PipelineSequencer {
    async shard(files) { return files }
    async sort(files) {
        const rank = (p) => p.includes('event-execute.test.js') ? 2 : (p.includes('/unit/') ? 1 : 0)
        return [...files].sort((a, b) => {
            const pa = a.moduleId ?? a.filepath ?? String(a)
            const pb = b.moduleId ?? b.filepath ?? String(b)
            const ra = rank(pa)
            const rb = rank(pb)
            return ra !== rb ? ra - rb : pa.localeCompare(pb)
        })
    }
}

export default defineConfig({
    resolve: { alias },
    test: {
        globals: true,
        environment: 'node',
        include: ['test/**/*.test.js'],
        exclude: ['**/node_modules/**', 'test/fixtures/**', 'test/integration/db/**'],
        setupFiles: ['./test/support/setup-env.js'],
        testTimeout: 120000,
        hookTimeout: 120000,
        // Match the former Jest `--runInBand`: strictly serial, one worker at a
        // time. Isolation stays ON (Jest isolates the module registry per test
        // file — the consumption apps re-boot per file and must re-read the
        // dynamic fixture-provider URLs, otherwise a cached RemoteService points
        // at a torn-down port).
        pool: 'forks',
        maxWorkers: 1,
        fileParallelism: false,
        sequence: { concurrent: false, sequencer: PipelineSequencer },
    },
})
