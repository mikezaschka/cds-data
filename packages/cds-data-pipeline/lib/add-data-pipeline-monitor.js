/**
 * `cds add data-pipeline-monitor` — wires the Pipeline Console (FCL) UI via CAP
 * reuse-and-compose manual mount (`app.serve(...).from(...)`).
 *
 * Use `Plugin` from `cds-dk` init (not `require('@sap/cds-dk')`), because `cds.add` is
 * only defined when the CLI runs `cds add` / `init` / `help` (see @sap/cds-dk `lib/index.js`).
 */
const cds = require('@sap/cds')
const { Plugin } = require('@sap/cds-dk/lib/init/add')
const { path, write } = cds.utils
const { join } = path
const fs = cds.utils.fs

const MOUNT_REQUIRE = "require('cds-data-pipeline/lib/mount-pipeline-console')"

module.exports = class extends Plugin {
    static help() {
        return 'Pipeline Console UI mounted from cds-data-pipeline at /pipeline-console (CAP reuse-and-compose).'
    }

    async run() {
        const src = join(__dirname, '..', 'app', 'pipeline-console')
        if (!fs.existsSync(src)) {
            throw new Error(
                '[cds-data-pipeline] Pre-built UI missing at app/pipeline-console — install from the published npm package',
            )
        }

        await this.#ensureServerMount()

        await write(
            [
                'Pipeline Console wired by `cds add data-pipeline-monitor`.',
                'Static UI is served from the `cds-data-pipeline` npm package at `/pipeline-console` (no local copy).',
                'The management OData API is at `/pipeline/`. Run `cds watch` and open `/pipeline-console/index.html`.',
            ].join('\n\n') + '\n',
        ).to('PIPELINE-CONSOLE.md')
    }

    async #ensureServerMount() {
        const serverPath = join(cds.root, 'server.js')
        if (!fs.existsSync(serverPath)) {
            await write(
                [
                    "const cds = require('@sap/cds')",
                    MOUNT_REQUIRE,
                    '',
                    'module.exports = cds.server',
                    '',
                ].join('\n'),
            ).to('server.js')
            return
        }

        const content = fs.readFileSync(serverPath, 'utf8')
        if (content.includes('mount-pipeline-console')) return

        const lines = content.split('\n')
        const cdsRequireIdx = lines.findIndex((line) =>
            /require\s*\(\s*['"]@sap\/cds['"]\s*\)/.test(line),
        )
        if (cdsRequireIdx >= 0) {
            lines.splice(cdsRequireIdx + 1, 0, MOUNT_REQUIRE)
        } else {
            lines.unshift("const cds = require('@sap/cds')", MOUNT_REQUIRE, '')
        }

        fs.writeFileSync(serverPath, lines.join('\n'), 'utf8')
    }
}
