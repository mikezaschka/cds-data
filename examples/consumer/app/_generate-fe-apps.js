#!/usr/bin/env node
/**
 * Generator for the Fiori Elements apps under examples/consumer/app/.
 *
 * Run with: node examples/consumer/app/_generate-fe-apps.js
 *
 * Each app is a minimal valid FE List Report / Object Page over an entity of
 * ConsumerService. Re-run this script whenever the list of apps changes.
 */
const fs = require('fs')
const path = require('path')

const APPS = [
    { dir: 'movies',              id: 'ns.movies',             title: 'Movies',              entity: 'Movies' },
    { dir: 'trending',            id: 'ns.trending',           title: 'Trending Movies',     entity: 'TrendingMovies' },
    { dir: 'award-winners',       id: 'ns.awardwinners',       title: 'Award-Winning',       entity: 'AwardWinningMovies' },
    { dir: 'films-rebranded',     id: 'ns.filmsrebranded',     title: 'Films (Rebranded)',   entity: 'Films' },
    { dir: 'actors',              id: 'ns.actors',             title: 'Actors',              entity: 'Actors' },
    { dir: 'directors',           id: 'ns.directors',          title: 'Directors',           entity: 'Directors' },
    { dir: 'licensed-movies',     id: 'ns.licensedmovies',     title: 'Licensed Movies',     entity: 'LicensedMovies' },
    { dir: 'streaming-manifests', id: 'ns.streamingmanifests', title: 'Streaming Manifests', entity: 'StreamingManifests' },
    { dir: 'watchlists',          id: 'ns.watchlists',         title: 'Watchlists',          entity: 'Watchlists' },
    { dir: 'reviews',             id: 'ns.reviews',            title: 'Reviews',             entity: 'Reviews' },
    { dir: 'replicated-movies',   id: 'ns.replicatedmovies',   title: 'Replicated Movies',   entity: 'ReplicatedMovies' },
    { dir: 'box-office',          id: 'ns.boxoffice',          title: 'Box Office',          entity: 'ReplicatedBoxOffice' }
]

function manifest({ id, title, entity }) {
    return {
        _version: '1.59.0',
        'sap.app': {
            id,
            type: 'application',
            title: '{{appTitle}}',
            description: '{{appTitle}}',
            applicationVersion: { version: '1.0.0' },
            dataSources: {
                mainService: {
                    uri: '/odata/v4/consumer/',
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
                minUI5Version: '1.108.0',
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
                        name: 'sap.fe.templates.ListReport',
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
