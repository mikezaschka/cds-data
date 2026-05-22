using { LogisticsService as logistics } from '../srv/external/LogisticsService';

namespace example06;

// Same Shipments projection as example 01 — the pipeline configuration
// is intentionally a near-clone so the reader sees the event-hook code
// as the only delta from the baseline replicate recipe.
@cds.persistence.table
entity Shipments as projection on logistics.Shipments {
    ID                 as id,
    orderId            as orderId,
    status             as status,
    carrier.code       as carrierCode,
    trackingNumber     as trackingNumber,
    shippedAt          as shippedAt,
    estimatedDelivery  as estimatedDelivery,
    actualDelivery     as actualDelivery,
    destinationCity    as destinationCity,
    destinationCountry as destinationCountry,
    modifiedAt         as modifiedAt
};

// Separate target for hook-produced metrics — each WRITE_BATCH hook below
// appends one row here so you can inspect per-batch behaviour by querying
// `/odata/v4/example/BatchMetrics`. In real code you'd ship these to
// Prometheus or Cloud Logging.
@cds.persistence.table
entity BatchMetrics {
    key runId      : UUID;
    key batchIndex : Integer;
        recordCount: Integer;
        writtenAt  : Timestamp;
}
