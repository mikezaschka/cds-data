const path = require('path')
const rootCds = path.join(__dirname, '../../node_modules/@sap/cds')

/** @type {import('jest').Config} */
module.exports = {
    moduleNameMapper: {
        '^@sap/cds$': rootCds,
        '^@sap/cds/(.*)$': `${rootCds}/$1`,
    },
    setupFiles: ['<rootDir>/test/support/jest-setup-env.js'],
    testMatch: ['<rootDir>/test/**/*.test.js'],
    testPathIgnorePatterns: [
        '/node_modules/',
        '<rootDir>/test/fixtures/',
    ],
    testTimeout: 120000,
    maxConcurrency: 1,
    forceExit: true,
    testSequencer: '<rootDir>/test/support/test-sequencer.js',
}
