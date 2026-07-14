/**
 * `cds add pipeline-console` — copies Pipeline Console UI into the consumer project
 * and wires the management API via index.cds import.
 *
 * Modelled after cds-caching lib/add.js.
 */
const cds = require('@sap/cds')
const { Plugin } = require('@sap/cds-dk/lib/init/add')
const { copy, path, write, fs } = cds.utils
const { join } = path

const APP_ID = 'cds.plugin.data_pipeline.console'
const UI5_VERSION = '1.150.0'

function resolveModuleId() {
    const project = cds.add?.readProject?.()
    if (project?.name) return project.name
    const pkgPath = join(cds.root, 'package.json')
    if (fs.existsSync(pkgPath)) {
        return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).name || 'app'
    }
    return 'app'
}

function builtUi5Yaml() {
    return `specVersion: "3.0"
metadata:
  name: ${APP_ID}
type: application
framework:
  name: OpenUI5
  version: "${UI5_VERSION}"
  libraries:
    - name: sap.m
    - name: sap.f
    - name: sap.ui.core
    - name: sap.ui.layout
    - name: themelib_sap_horizon
`
}

function sourceUi5Yaml(moduleId) {
    return `specVersion: "3.0"
metadata:
  name: ${APP_ID}
type: application
framework:
  name: OpenUI5
  version: "${UI5_VERSION}"
  libraries:
    - name: sap.m
    - name: sap.f
    - name: sap.ui.core
    - name: sap.ui.layout
    - name: themelib_sap_horizon
builder:
  customTasks:
    - name: ui5-tooling-transpile-task
      afterTask: replaceVersion
      configuration:
        transformTypeScript: true
server:
  customMiddleware:
    - name: ui5-tooling-transpile-middleware
      afterMiddleware: compression
      configuration:
        transformTypeScript: true
    - name: ui5-middleware-cap
      afterMiddleware: compression
      configuration:
        moduleId: ${moduleId}
`
}

function ui5DeployYaml() {
    return `specVersion: "3.0"
metadata:
  name: ${APP_ID}
type: application
resources:
  configuration:
    propertiesFileSourceEncoding: UTF-8
extends:
  path: ui5.yaml
builder:
  resources:
    excludes:
      - /test/**
      - /localService/**
  customTasks:
    - name: ui5-task-zipper
      afterTask: generateCachebusterInfo
      configuration:
        archiveName: ${APP_ID}
        relativePaths: true
        additionalFiles:
          - xs-app.json
`
}

const CONSOLE_SCRIPTS = {
    start: 'ui5 serve -o index.html',
    build: 'ui5 build --clean-dest --dest dist',
    'build:cf':
        'ui5 build --clean-dest --config ui5-deploy.yaml --include-task=generateCachebusterInfo',
}

const CONSOLE_UI5_DEPS = {
    '@ui5/cli': '^4',
    'ui5-task-zipper': '^3',
}

function xsAppJson() {
    return `${JSON.stringify(
        {
            welcomeFile: '/index.html',
            authenticationMethod: 'route',
            routes: [
                {
                    source: '^/pipeline/(.*)$',
                    target: '/pipeline/$1',
                    destination: 'srv-api',
                    authenticationType: 'xsuaa',
                    csrfProtection: true,
                },
                {
                    source: '^(.*)$',
                    target: '$1',
                    service: 'html5-apps-repo-rt',
                    authenticationType: 'xsuaa',
                },
            ],
        },
        null,
        2,
    )}\n`
}

function builtPackageJson() {
    return `${JSON.stringify(
        {
            name: APP_ID,
            version: '1.0.0',
            description: 'cds-data-pipeline Pipeline Console',
            private: true,
            scripts: CONSOLE_SCRIPTS,
            devDependencies: CONSOLE_UI5_DEPS,
        },
        null,
        2,
    )}\n`
}

function sourcePackageJson() {
    return `${JSON.stringify(
        {
            name: APP_ID,
            version: '1.0.0',
            description: 'cds-data-pipeline Pipeline Console',
            private: true,
            scripts: CONSOLE_SCRIPTS,
            devDependencies: {
                ...CONSOLE_UI5_DEPS,
                '@openui5/types': `^${UI5_VERSION}`,
                typescript: '^5.8.3',
                'ui5-middleware-cap': '^3.3.0',
                'ui5-tooling-transpile': '^3.5.0',
            },
        },
        null,
        2,
    )}\n`
}

function tsconfigJson() {
    return `${JSON.stringify(
        {
            compilerOptions: {
                target: 'es2023',
                module: 'es2022',
                moduleResolution: 'node',
                skipLibCheck: true,
                allowJs: true,
                strict: true,
                strictNullChecks: false,
                strictPropertyInitialization: false,
                rootDir: './webapp',
                types: ['@openui5/types'],
            },
            include: ['./webapp/**/*'],
        },
        null,
        2,
    )}\n`
}

function getScaffoldFiles(source, moduleId) {
    const files = {
        'app/pipeline-console/ui5.yaml': source ? sourceUi5Yaml(moduleId) : builtUi5Yaml(),
        'app/pipeline-console/ui5-deploy.yaml': ui5DeployYaml(),
        'app/pipeline-console/xs-app.json': xsAppJson(),
        'app/pipeline-console/package.json': source ? sourcePackageJson() : builtPackageJson(),
    }
    if (source) {
        files['app/pipeline-console/tsconfig.json'] = tsconfigJson()
    }
    return files
}

class AddPipelineConsole extends Plugin {
    options() {
        return {
            source: {
                type: 'boolean',
                default: false,
                help: 'Copy TypeScript source instead of the pre-built console (for customization).',
            },
        }
    }

    async run() {
        const source = !!cds.cli?.options?.source
        const srcRoot = join(__dirname, '..', 'app', source ? 'pipeline-console-src' : 'pipeline-console')
        const src = source ? join(srcRoot, 'webapp') : srcRoot
        await copy(src).to('app', 'pipeline-console', 'webapp')

        const files = getScaffoldFiles(source, resolveModuleId())
        for (const [target, content] of Object.entries(files)) {
            if (!fs.existsSync(join(cds.root, target))) {
                await write(content).to(target)
            }
        }

        const cdsFile = join(cds.root, 'srv', 'pipeline-management.cds')
        if (!fs.existsSync(cdsFile)) {
            await write("using from 'cds-data-pipeline/index.cds';\n").to('srv/pipeline-management.cds')
        }
    }
}

AddPipelineConsole.getScaffoldFiles = getScaffoldFiles
AddPipelineConsole.resolveModuleId = resolveModuleId

module.exports = AddPipelineConsole
