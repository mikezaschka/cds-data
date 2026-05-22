using { plugin.data_pipeline.sourced } from 'cds-data-pipeline/db';

namespace example05;

// Consolidated fan-in target — one table for rows from every LogisticsService
// instance. The `sourced` aspect ships from the plugin and adds
//   key source : String(100)
// extending the key so rows with the same business key but different
// origins coexist. It also provides the `source` extension on associations
// the recipe docs call out (not needed here — no associations on this target).
//
// Without this aspect, `addPipeline` would reject `source.origin` at
// registration time, with an error message pointing at the exact
// `using { plugin.data_pipeline.sourced } from 'cds-data-pipeline/db';`
// import path.
@cds.persistence.table
entity Shipments : sourced {
    key ID                : UUID;
        orderId           : Integer;
        status            : String(20);
        carrierCode       : String(10);
        trackingNumber    : String(50);
        shippedAt         : Timestamp;
        estimatedDelivery : Timestamp;
        actualDelivery    : Timestamp;
        destinationCity   : String(80);
        destinationCountry: String(3);
        modifiedAt        : Timestamp;
}
