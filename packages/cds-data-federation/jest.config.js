const path = require('path')
const rootCds = path.join(__dirname, '../../node_modules/@sap/cds')

const shared = {
    moduleNameMapper: {
        '^@sap/cds$': rootCds,
        '^@sap/cds/(.*)$': `${rootCds}/$1`,
    },
    testTimeout: 120000,
    testPathIgnorePatterns: [
        '/node_modules/',
        '<rootDir>/test/fixtures/',
    ],
}

/** @type {import('jest').Config} */
module.exports = {
    maxConcurrency: 1,
    forceExit: true,
    projects: [
        {
            ...shared,
            displayName: 'integration',
            setupFiles: ['<rootDir>/test/support/jest-setup-env.js'],
            testMatch: ['<rootDir>/test/**/*.test.js'],
            testPathIgnorePatterns: [
                ...shared.testPathIgnorePatterns,
                'entity-cache-mt\\.test\\.js',
            ],
        },
        {
            ...shared,
            displayName: 'ec-mt',
            setupFiles: ['<rootDir>/test/support/jest-setup-env-ec-mt.js'],
            testMatch: ['<rootDir>/test/integration/caching/entity-cache-mt.test.js'],
        },
    ],
}
