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

export default defineConfig({
    resolve: { alias },
    test: {
        globals: true,
        environment: 'node',
        include: ['test/**/*.test.js'],
        exclude: ['**/node_modules/**', 'test/fixtures/**', 'test/spike/**'],
        setupFiles: ['./test/support/setup-env.js'],
        testTimeout: 120000,
        hookTimeout: 120000,
        pool: 'forks',
        maxWorkers: 1,
        fileParallelism: false,
        sequence: { concurrent: false },
    },
})
