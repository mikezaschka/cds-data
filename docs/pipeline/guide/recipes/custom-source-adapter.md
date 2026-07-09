# Custom source adapter

**When to pick this recipe:** the source is not OData V2 / V4, not REST, and not a CQN-native CAP service — flat files (CSV, JSONL), proprietary HTTP APIs, message buses, S3 objects, whatever else. Writing a source adapter is the sanctioned extension point; custom adapters have the same standing as the built-in ones.

For the formal contract and resolution order see [Sources → Custom source adapter](../sources/custom.md). This page walks through a concrete scenario end-to-end.

## Scenario — import a CSV file on a schedule

A daily customer export lands on a file share as CSV. You want the rows in a local CAP-managed table, with timestamp-based delta so only new / changed rows are imported after the first run.

## Adapter

Extend `BaseSourceAdapter` and own the translation from config + tracker to a batched `readStream(tracker)`:

```javascript
// adapters/CsvFileAdapter.js
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

            // Adapter owns delta filtering — the engine just hands you the
            // tracker and expects you to honour its watermark.
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
            queryShape: false,                 // no SELECT CQN over a file
            deltaTimestamp: true,
            deltaKey: false,
            deltaDatetimeFields: false,
        };
    }
}

module.exports = CsvFileAdapter;
```

## Target

A plain local CAP table — the custom source adapter plugs into the standard pipeline, so the target can still be the default [`DbTargetAdapter`](../targets/db.md):

```cds
namespace db;

@cds.persistence.table
entity Customers {
    key ID         : String(20);
        name       : String(100);
        email      : String(100);
        modifiedAt : Timestamp;
}
```

## Pipeline registration

```javascript
const cds = require('@sap/cds');
const CsvFileAdapter = require('./adapters/CsvFileAdapter');

module.exports = async () => {
    const pipelines = await cds.connect.to('DataPipelineService');

    await pipelines.addPipeline({
        name: 'ImportCustomers',
        source: {
            service: 'db',                  // any connect-able service; used only for the proxy
            path: '/data/customers.csv',
            adapter: CsvFileAdapter,        // takes precedence over source.kind
        },
        target: { entity: 'db.Customers' },
        delta: { mode: 'timestamp', field: 'modifiedAt' },
        schedule: 86400000,                 // once a day
    });
};
```

`source.adapter` is a class reference — the plugin instantiates it once per pipeline, injects `this.service` and `this.config`, and calls `readStream(tracker)` at each run. Because `source.adapter` takes precedence over the kind-based dispatch, the value of `source.service` is only used to provide `this.service` for adapters that want a CAP service handle; the CSV adapter above ignores it.

## What happens at runtime

1. The scheduler fires at midnight.
2. A tracker row is opened and `CsvFileAdapter.readStream(tracker)` is called.
3. The generator yields record batches; each one is awaited (backpressure) before the next is requested.
4. `PIPELINE.MAP` runs per batch — identity by default, or a `remoteToLocal` rename if supplied.
5. `DbTargetAdapter.writeBatch(records, { mode: 'upsert' })` UPSERTs into `db.Customers`.
6. After the stream ends, the tracker row is updated with the new `lastSync`.

## When to pick this over a write-hook override

Use a custom source adapter when you want the extension reusable across pipelines and composable with the standard target adapters. If the transformation is one-off and read-only (e.g. poking at a URL and shoving the result into the DB), a `PIPELINE.READ` event-hook override can also work — but the adapter route keeps delta-watermark and backpressure handling on the standard contract.

## See also

- [Sources → Custom source adapter](../sources/custom.md) — the formal `BaseSourceAdapter` contract.
- [Sources → overview](../sources/index.md) — resolution order.
- [Concepts → Inference rules](../concepts/inference.md) — how `source.adapter` interacts with `source.kind`.
- [Recipes → Custom target adapter](custom-target-adapter.md) — the peer recipe for the WRITE phase.
