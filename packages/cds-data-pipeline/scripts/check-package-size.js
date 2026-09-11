const { spawnSync } = require('node:child_process')
const path = require('node:path')

const MAX_UNPACKED_SIZE = 2_000_000
const MAX_FILE_COUNT = 500

const result = spawnSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
    },
)

if (result.status !== 0) {
    process.stderr.write(result.stderr)
    process.exit(result.status || 1)
}

const [pack] = JSON.parse(result.stdout)
const paths = pack.files.map(({ path: filePath }) => filePath)
const forbidden = paths.filter(
    (filePath) =>
        filePath.includes('node_modules/') ||
        filePath.startsWith('app/pipeline-console/resources/') ||
        filePath.startsWith('app/pipeline-console/test-resources/'),
)

const failures = []
if (pack.unpackedSize > MAX_UNPACKED_SIZE) {
    failures.push(`unpacked size ${pack.unpackedSize} exceeds ${MAX_UNPACKED_SIZE} bytes`)
}
if (pack.entryCount > MAX_FILE_COUNT) {
    failures.push(`file count ${pack.entryCount} exceeds ${MAX_FILE_COUNT}`)
}
if (forbidden.length) {
    failures.push(`forbidden package paths:\n${forbidden.map((file) => `  - ${file}`).join('\n')}`)
}

if (failures.length) {
    throw new Error(`cds-data-pipeline package check failed:\n${failures.join('\n')}`)
}

process.stdout.write(
    `Package check passed: ${pack.size} bytes packed, ${pack.unpackedSize} bytes unpacked, ` +
        `${pack.entryCount} files.\n`,
)
