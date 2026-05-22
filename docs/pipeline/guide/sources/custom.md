# Custom source adapter

When the transport you need to read from is not one of the built-in kinds (OData V2 / V4, REST, CQN), write a source adapter. Extend `BaseSourceAdapter` and implement `readStream(tracker)` as an async generator, then pass the class via `config.source.adapter`.

Custom source adapters have the same standing as the built-in ones — every READ goes through the resolved adapter.

## Contract

```javascript
const BaseSourceAdapter = require('cds-data-pipeline/srv/adapters/BaseSourceAdapter');

class MyAdapter extends BaseSourceAdapter {
    async *readStream(tracker) {
        // Yield arrays of plain-object records. The caller awaits each yield
        // before asking for the next — respect backpressure.
    }

    capabilities() {
        return {
            entityShape: true,
            queryShape: false,
            deltaTimestamp: true,
            deltaKey: false,
            deltaDatetimeFields: false,
        };
    }
}
```

Inputs available inside `readStream(tracker)`:

- `this.service` — the connected CAP service proxy (`cds.connect.to(config.source.service)`).
- `this.config` — the normalized pipeline config (do not mutate).
- `tracker` — the current `Pipelines` row: `{ lastSync, lastKey, status, ... }`.

Adapters must translate the `config.delta` + `tracker` state into a source-side predicate themselves (OData `$filter`, REST query param, CQN `WHERE`, …). Query-shape pipelines (with `config.source.query` present) sidestep delta — the user's closure decides whether to gate on the tracker.

## Resolution order

Source adapters are resolved in this order:

1. `config.source.adapter` — class reference extending `BaseSourceAdapter`. Full control; skips everything below.
2. `config.source.kind` — explicit transport selector: `'cqn' | 'odata' | 'odata-v2' | 'rest'`.
3. `cds.requires.<service>.kind` (or `remote.kind`) — auto-detected for annotation-wired pipelines. Unknown values fall back to `ODataAdapter`.

## Worked example — a CSV-file source adapter

```javascript
const fs = require('fs');
const readline = require('readline');
const BaseSourceAdapter = require('cds-data-pipeline/srv/adapters/BaseSourceAdapter');

class CsvFileAdapter extends BaseSourceAdapter {
    async *readStream(tracker) {
        const path = this.config.source.path;
        if (!path) {
            throw new Error(`CsvFileAdapter: source.path is required`);
        }

        const batchSize = this.config.source.batchSize || 1000;
        const stream = fs.createReadStream(path, 'utf8');
        const lines = readline.createInterface({ input: stream });

        let header = null;
        let batch = [];
        for await (const line of lines) {
            if (!header) {
                header = line.split(',');
                continue;
            }
            const cols = line.split(',');
            const row = Object.fromEntries(header.map((h, i) => [h, cols[i]]));

            // Adapter owns delta filtering. Trivial timestamp watermark:
            if (tracker.lastSync && row.modifiedAt && row.modifiedAt <= tracker.lastSync) {
                continue;
            }

            batch.push(row);
            if (batch.length >= batchSize) {
                yield batch;
                batch = [];
            }
        }
        if (batch.length > 0) yield batch;
    }

    capabilities() {
        return {
            entityShape: true,
            queryShape: false,
            deltaTimestamp: true,
            deltaKey: false,
            deltaDatetimeFields: false,
        };
    }
}

module.exports = CsvFileAdapter;
```

Register a pipeline with the adapter plugged in:

```javascript
const CsvFileAdapter = require('./adapters/CsvFileAdapter');

await pipelines.addPipeline({
    name: 'ImportCustomers',
    source: {
        service: 'db',          // any connect-able service; used only for the proxy
        path: '/data/customers.csv',
        adapter: CsvFileAdapter,
    },
    target: { entity: 'db.Customers' },
    delta: { mode: 'timestamp', field: 'modifiedAt' },
});
```

## See also

- [Sources → overview](index.md) — resolution order and the built-in adapters.
- [Targets → Custom target adapter](../targets/custom.md) — the peer contract for the WRITE phase.
- [Recipes → Custom source adapter](../recipes/custom-source-adapter.md) — scenario-driven walkthrough.
- [Concepts → Inference rules](../concepts/inference.md) — read-shape inference and the validation matrix.
