using { LogisticsService as logistics } from '../srv/external/LogisticsService';

namespace consoleDev;

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

@cds.persistence.table
entity ShipmentsWithHooks as projection on logistics.Shipments {
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

@cds.persistence.table
entity Carriers as projection on logistics.Carriers {
    code         as code,
    name         as name,
    serviceLevel as serviceLevel,
    contactEmail as contactEmail
};

@cds.persistence.table
entity FxRates {
    key ID            : String(30);
        baseCurrency  : String(3);
        quoteCurrency : String(3);
        rate          : Decimal(10, 4);
        rateDate      : Date;
        modifiedAt    : Timestamp;
}

@cds.persistence.table
entity BatchMetrics {
    key runId      : UUID;
    key batchIndex : Integer;
        recordCount: Integer;
        writtenAt  : Timestamp;
}
