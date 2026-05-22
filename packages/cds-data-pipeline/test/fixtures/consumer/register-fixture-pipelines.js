/**
 * Registers standard pipelines for Jest integration tests when the test consumer
 * app is served. Loaded from the main cds-data-pipeline cds-plugin when
 * CDS_PIPELINE_TEST_CONSUMER=true (see test/support/jest-setup-env.js).
 *
 * CAP does not load project-local cds-plugin.js from app folders — only from
 * dependency packages — so this file is required explicitly for tests.
 */
const cds = global.cds
if (!cds) throw new Error('global.cds must be set before register-fixture-pipelines.js')

function resetFixturePipelineGate() {
    global.__consumerFixturePipelinesReady = new Promise((resolve) => {
        global.__resolveConsumerFixturePipelines = resolve
    })
}

resetFixturePipelineGate()

cds.on('shutdown', () => {
    resetFixturePipelineGate()
})

const productViewMapping = {
    isWildcard: false,
    projectedColumns: ['ID', 'name', 'category', 'price', 'currency'],
    remoteToLocal: {
        ID: 'productId',
        name: 'productName',
        price: 'unitPrice',
    },
    localToRemote: {},
}

const pipelines = [
    {
        name: 'ReplicatedCustomers',
        source: { service: 'ProviderService', entity: 'Customers' },
        target: { entity: 'consumer.ReplicatedCustomers' },
        mode: 'delta',
        delta: { mode: 'timestamp', field: 'modifiedAt' },
    },
    {
        name: 'ReplicatedCustomersV2',
        source: { service: 'ProviderServiceV2', entity: 'Customers' },
        target: { entity: 'consumer.ReplicatedCustomersV2' },
        mode: 'delta',
        delta: { mode: 'timestamp', field: 'modifiedAt' },
    },
    {
        name: 'ReplicatedProducts',
        source: { service: 'ProviderService', entity: 'Products' },
        target: { entity: 'consumer.ReplicatedProducts' },
        mode: 'delta',
        delta: { mode: 'timestamp', field: 'modifiedAt' },
        viewMapping: productViewMapping,
    },
    {
        name: 'InferredViewProducts',
        source: { service: 'ProviderService', entity: 'Products' },
        target: { entity: 'consumer.InferredViewProducts' },
        mode: 'delta',
        delta: { mode: 'timestamp', field: 'modifiedAt' },
    },
    {
        name: 'ReplicatedPagedCustomers',
        source: { service: 'ProviderService', entity: 'PagedCustomers', batchSize: 100 },
        target: { entity: 'consumer.ReplicatedPagedCustomers' },
        mode: 'delta',
        delta: { mode: 'timestamp', field: 'modifiedAt' },
    },
    {
        name: 'ReplicatedRestCustomers',
        source: { service: 'RestProvider', batchSize: 100 },
        rest: {
            path: '/api/customers',
            pagination: { type: 'offset', pageSize: 100 },
            deltaParam: 'modifiedSince',
            dataPath: 'results',
        },
        target: { entity: 'consumer.ReplicatedRestCustomers' },
        mode: 'delta',
        delta: { mode: 'timestamp', field: 'modifiedAt' },
    },
    {
        name: 'MoveCustomersToInventory',
        source: { service: 'ProviderService', entity: 'Customers' },
        target: { service: 'InventoryService', entity: 'InventoryService.MirroredCustomers' },
        mode: 'delta',
        delta: { mode: 'timestamp', field: 'modifiedAt' },
    },
    {
        name: 'FanInOriginA',
        source: { service: 'ProviderService', entity: 'Customers', origin: 'ORIGIN_A' },
        target: { entity: 'consumer.FanInCustomers' },
        mode: 'delta',
        delta: { mode: 'timestamp', field: 'modifiedAt' },
    },
    {
        name: 'FanInOriginB',
        source: { service: 'ProviderService', entity: 'Customers', origin: 'ORIGIN_B' },
        target: { entity: 'consumer.FanInCustomers' },
        mode: 'delta',
        delta: { mode: 'timestamp', field: 'modifiedAt' },
    },
]

async function registerPipelines() {
    let srv
    for (let i = 0; i < 100; i++) {
        srv = await cds.connect.to('DataPipelineService')
        if (srv) break
        await new Promise(r => setTimeout(r, 20))
    }
    if (!srv) {
        throw new Error('DataPipelineService not available after served; cannot register fixture pipelines')
    }
    for (const cfg of pipelines) {
        try {
            await srv.addPipeline(cfg)
        } catch (err) {
            if (err.message && err.message.includes('already exists')) continue
            cds.log('test-consumer').warn(`fixture pipeline '${cfg.name}' skipped: ${err.message}`)
        }
    }
}

cds.on('served', () => {
    registerPipelines()
        .catch(err => cds.log('test-consumer').error(err))
        .finally(() => global.__resolveConsumerFixturePipelines())
})
