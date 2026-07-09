'use strict'

require('@sap/cds')
const cds = global.cds

/**
 * Point the test consumer at a Postgres instance (local docker or CI service).
 * Overrides the fixture package.json sqlite binding set in setup-env.js.
 */
function applyPostgresDbConfig() {
    const r = (cds.env.requires ||= {})
    r.db = {
        kind: 'postgres',
        credentials: {
            host: process.env.CDS_TEST_PG_HOST || 'localhost',
            port: Number(process.env.CDS_TEST_PG_PORT || 5432),
            user: process.env.CDS_TEST_PG_USER || 'postgres',
            password: process.env.CDS_TEST_PG_PASSWORD || 'postgres',
            database: process.env.CDS_TEST_PG_DATABASE || 'cds_data_pipeline_test',
        },
    }
}

/**
 * Strip remote fixture entities (OData V2 CSN / provider namespace) from a
 * loaded model before `cds.deploy` to Postgres. The consumer schema references
 * ProviderService for InferredViewProducts only; those types use nvarchar and
 * must not be materialized on Postgres.
 */
function persistenceModelForPostgres(model) {
    const definitions = {}
    for (const [name, def] of Object.entries(model.definitions)) {
        if (name.startsWith('provider.')) continue
        if (name.startsWith('ProviderService.')) continue
        if (name === 'consumer.InferredViewProducts') continue
        definitions[name] = def
    }
    return {
        namespace: model.namespace,
        definitions,
        $sources: model.$sources,
        $location: model.$location,
        meta: model.meta,
        $version: model.$version,
    }
}

const POSTGRES_DEPLOY_OPTS = {
    dialect: 'postgres',
    kind: 'postgres',
    schema_evolution: false,
}

/** Deploy consumer + pipeline persistence to the configured Postgres db. */
async function deployPostgresFixture() {
    const full = await cds.load('db')
    const model = persistenceModelForPostgres(full)
    const db = await cds.connect.to('db')
    await db.run(async tx => {
        await cds.deploy.schema(tx, model, POSTGRES_DEPLOY_OPTS)
        // Full model for CSV discovery ($sources); provider rows are skipped
        // because provider entities are absent from the filtered CSN.
        await cds.deploy.data(tx, model, POSTGRES_DEPLOY_OPTS)
    })
    return db
}

module.exports = {
    applyPostgresDbConfig,
    persistenceModelForPostgres,
    deployPostgresFixture,
}
