import cds from '@sap/cds/eslint.config.mjs'

// ESLint 9+/flat config no longer honors `.eslintignore`, and the CDS 10
// recommended config only ignores its own generated output. Everything below is
// vendored or build-generated (UI5 runtime libs, VitePress build + cache output,
// generated doc sites, minified bundles, source maps) — never hand-authored
// source — so it must be excluded before linting.
export default [
    {
        ignores: [
            '**/node_modules/**',
            '**/gen/**',
            '**/dist/**',
            '**/site/**',
            '**/.vitepress/cache/**',
            '**/.vitepress/dist/**',
            '.venv/**',
            // UI5 build artifacts under the pipeline-console app.
            '**/app/pipeline-console/resources/**',
            '**/Component-preload.js',
            '**/*-dbg.js',
            '**/*.min.js',
            '**/*.js.map',
        ],
    },
    ...cds.recommended,
    {
        // Vitest exposes its API as globals (`globals: true` in vitest.config).
        // Declare them so lint doesn't flag `vi` and friends as undefined.
        files: ['**/test/**/*.js', '**/*.test.js'],
        languageOptions: {
            globals: {
                vi: 'readonly',
                vitest: 'readonly',
                describe: 'readonly',
                it: 'readonly',
                test: 'readonly',
                expect: 'readonly',
                beforeAll: 'readonly',
                afterAll: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
            },
        },
    },
]
