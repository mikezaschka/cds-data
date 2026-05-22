#!/usr/bin/env node
/**
 * Generator for the Sales Intelligence Workbench Fiori Elements apps.
 *
 * Run with:
 *   node examples/sales-intel/workbench/app/_generate-fe-apps.js
 *
 * Each app is a minimal valid List Report / Object Page over a single entity.
 * Phase 1 MVP ships four apps; the Customer 360 launchpad tile reuses the
 * `customers` app with a different framing.
 */
const fs = require('fs')
const path = require('path')

// dataSource: which OData service the app talks to.
//   'sales'    → /odata/v4/sales-intel/
//   'pipeline' → /pipeline/   (cds-data-pipeline management service)
const APPS = [
    { dir: 'customer-notes',    id: 'sales.customernotes',    title: 'Customer Notes',    entity: 'CustomerNotes', dataSource: 'sales' },
    { dir: 'customers',         id: 'sales.customers',        title: 'Customers',         entity: 'Customers',     dataSource: 'sales' },
    { dir: 'sales-analytics',   id: 'sales.salesanalytics',   title: 'Sales Analytics',   entity: 'SalesOrders',   dataSource: 'sales', template: 'alp' },
    { dir: 'federation-monitor', id: 'sales.federationmonitor', title: 'Pipeline Monitor', entity: 'Pipelines', dataSource: 'pipeline' }
]

const DATA_SOURCES = {
    sales:    { uri: '/odata/v4/sales-intel/' },
    pipeline: { uri: '/pipeline/' }
}

function manifest({ id, title, entity, dataSource, template }) {
    const uri = DATA_SOURCES[dataSource].uri
    const isAlp = template === 'alp'
    const listTemplate = isAlp
        ? 'sap.fe.templates.AnalyticalListPage'
        : 'sap.fe.templates.ListReport'

    const m = {
        _version: '1.59.0',
        'sap.app': {
            id,
            type: 'application',
            title: '{{appTitle}}',
            description: '{{appTitle}}',
            applicationVersion: { version: '1.0.0' },
            dataSources: {
                mainService: {
                    uri,
                    type: 'OData',
                    settings: { odataVersion: '4.0' }
                }
            }
        },
        'sap.ui': {
            technology: 'UI5',
            deviceTypes: { desktop: true, tablet: true, phone: true }
        },
        'sap.ui5': {
            dependencies: {
                minUI5Version: '1.120.0',
                libs: {
                    'sap.m': {},
                    'sap.ui.core': {},
                    'sap.fe.templates': {}
                }
            },
            models: {
                i18n: {
                    type: 'sap.ui.model.resource.ResourceModel',
                    settings: { bundleName: `${id}.i18n.i18n` }
                },
                '': {
                    dataSource: 'mainService',
                    settings: {
                        synchronizationMode: 'None',
                        operationMode: 'Server',
                        autoExpandSelect: true,
                        earlyRequests: true
                    },
                    type: 'sap.ui.model.odata.v4.ODataModel'
                }
            },
            routing: {
                routes: [
                    { pattern: ':?query:', name: 'List', target: 'List' },
                    { pattern: `${entity}({key}):?query:`, name: 'Detail', target: 'Detail' }
                ],
                targets: {
                    List: {
                        type: 'Component',
                        id: 'List',
                        name: listTemplate,
                        options: {
                            settings: {
                                contextPath: `/${entity}`,
                                variantManagement: 'Page',
                                initialLoad: true,
                                navigation: {
                                    [entity]: { detail: { route: 'Detail' } }
                                }
                            }
                        }
                    },
                    Detail: {
                        type: 'Component',
                        id: 'Detail',
                        name: 'sap.fe.templates.ObjectPage',
                        options: { settings: { contextPath: `/${entity}` } }
                    }
                }
            },
            contentDensities: { compact: true, cozy: true }
        }
    }
    return m
}

function componentJs(id) {
    return `sap.ui.define([
    "sap/fe/core/AppComponent"
], function(AppComponent) {
    "use strict";
    return AppComponent.extend("${id}.Component", {
        metadata: { manifest: "json" }
    });
});
`
}

function indexHtml({ id, title }) {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <script
        id="sap-ui-bootstrap"
        src="https://ui5.sap.com/resources/sap-ui-core.js"
        data-sap-ui-theme="sap_horizon"
        data-sap-ui-resourceroots='{"${id}": "./"}'
        data-sap-ui-oninit="module:sap/ui/core/ComponentSupport"
        data-sap-ui-compatVersion="edge"
        data-sap-ui-async="true"></script>
</head>
<body class="sapUiBody">
    <div data-sap-ui-component data-name="${id}" data-id="container" data-settings='{"id":"${id.split('.').pop()}"}'></div>
</body>
</html>
`
}

function i18nProps(title) {
    return `appTitle=${title}\n`
}

function ensureDir(d) {
    fs.mkdirSync(d, { recursive: true })
}

function writeIfChanged(filePath, content) {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return
    ensureDir(path.dirname(filePath))
    fs.writeFileSync(filePath, content)
    // eslint-disable-next-line no-console
    console.log('wrote', path.relative(process.cwd(), filePath))
}

const ROOT = __dirname
for (const app of APPS) {
    const base = path.join(ROOT, app.dir, 'webapp')
    writeIfChanged(path.join(base, 'manifest.json'), JSON.stringify(manifest(app), null, 2) + '\n')
    writeIfChanged(path.join(base, 'Component.js'), componentJs(app.id))
    writeIfChanged(path.join(base, 'index.html'), indexHtml(app))
    writeIfChanged(path.join(base, 'i18n', 'i18n.properties'), i18nProps(app.title))
}

// eslint-disable-next-line no-console
console.log(`Generated ${APPS.length} FE apps.`)
