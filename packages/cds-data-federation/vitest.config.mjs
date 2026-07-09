import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootCds = path.join(__dirname, '../../node_modules/@sap/cds')

// Alias `@sap/cds` to the hoisted root copy so npm-workspaces / `file:` installs
// never resolve a second, nested `@sap/cds`.
const alias = [
    { find: /^@sap\/cds$/, replacement: rootCds },
    { find: /^@sap\/cds\/(.*)$/, replacement: `${rootCds}/$1` },
]

// Serial defaults matching the former Jest `--runInBand`: strictly serial, one
// worker at a time. Isolation stays ON (Jest isolates the module registry per
// test file — apps re-boot per file and must re-read dynamic fixture URLs).
const serial = {
    globals: true,
    environment: 'node',
    testTimeout: 120000,
    hookTimeout: 120000,
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    sequence: { concurrent: false },
}

export default defineConfig({
    resolve: { alias },
    test: {
        projects: [
            {
                resolve: { alias },
                test: {
                    ...serial,
                    name: 'integration',
                    setupFiles: ['./test/support/setup-env.js'],
                    include: ['test/**/*.test.js'],
                    exclude: ['**/node_modules/**', 'test/fixtures/**', '**/entity-cache-mt.test.js'],
                },
            },
            {
                resolve: { alias },
                test: {
                    ...serial,
                    name: 'ec-mt',
                    setupFiles: ['./test/support/setup-env-ec-mt.js'],
                    include: ['test/integration/caching/entity-cache-mt.test.js'],
                    exclude: ['**/node_modules/**', 'test/fixtures/**'],
                },
            },
        ],
    },
})
