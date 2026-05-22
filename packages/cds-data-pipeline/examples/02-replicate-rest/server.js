const cds = require('@sap/cds')

// Replicate from a plain HTTP endpoint (FXService at :4456) into a local
// SQLite table. Demonstrates the `RestAdapter` with offset pagination,
// a tracker-driven `modifiedSince` query parameter, and `dataPath` for
// extracting rows out of a `{ results: [...], total }` envelope.
cds.on('served', async () => {
    const pipelines = await cds.connect.to('DataPipelineService')

    await pipelines.addPipeline({
        name: 'ExchangeRates',
        source: { service: 'FXService' },
        target: { entity: 'example02.ExchangeRates' },

        // The REST adapter takes its request config from `config.rest`.
        // - `path`        : appended to `credentials.url` from cds.requires
        // - `pagination`  : 'offset' emits `limit` / `offset` (FXService
        //                   reads these). 'cursor' / 'page' are the other
        //                   built-in modes — see docs/guide/sources/rest.md.
        // - `deltaParam`  : URL param populated from tracker.lastSync on
        //                   incremental runs. First run omits the param
        //                   (no watermark yet) and fetches everything.
        // - `dataPath`    : JSONPath into the response envelope. Here the
        //                   payload is `{ results: [...], total }`, so rows
        //                   live under `results`.
        rest: {
            path: '/api/rates',
            pagination: { type: 'offset', pageSize: 100 },
            deltaParam: 'modifiedSince',
            dataPath: 'results',
        },

        // FXService exposes a `modifiedAt` timestamp on every rate. Match
        // that to the delta field; the adapter wires this to `deltaParam`
        // on the wire.
        delta: { mode: 'timestamp', field: 'modifiedAt' },

        // Row shape already matches the target — default identity MAP.
        schedule: 60_000,
    })
})

module.exports = cds.server
