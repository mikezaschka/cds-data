using { LogisticsService as logistics } from '../srv/external/LogisticsService';

namespace example07;

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
