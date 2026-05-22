using { LogisticsService as logistics } from '../srv/external/LogisticsService';

namespace example01;

// Consumption view on the remote LogisticsService.Shipments entity.
// The `@cds.persistence.table` annotation tells CAP to materialize this
// projection as a local table (rather than resolve it remotely at query
// time) so the pipeline has somewhere to write. The projection doubles
// as: (a) the target schema, (b) the column restriction (only these
// fields are read from the remote), and (c) the source-to-target rename
// map — surfaced to the pipeline via `viewMapping.remoteToLocal` in
// srv/pipelines.js.
//
// See docs/concepts/consumption-views.md for the full pattern.
@cds.persistence.table
entity Shipments as projection on logistics.Shipments {
    ID                as id,
    orderId           as orderId,
    status            as status,
    carrier.code      as carrierCode,
    trackingNumber    as trackingNumber,
    shippedAt         as shippedAt,
    estimatedDelivery as estimatedDelivery,
    actualDelivery    as actualDelivery,
    destinationCity   as destinationCity,
    destinationCountry as destinationCountry,
    modifiedAt        as modifiedAt
};
