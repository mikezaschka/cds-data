namespace logistics;

type ShipmentStatus : String(20) enum {
    pending;
    in_transit;
    out_for_delivery;
    delivered;
    exception;
}

type ServiceLevel : String(20) enum {
    standard;
    express;
    overnight;
    freight;
}

entity Carriers {
    key code         : String(10);
        name         : String(100);
        serviceLevel : ServiceLevel;
        contactEmail : String(100);
}

entity Shipments {
    key ID                : UUID;
        orderId           : Integer;
        status            : ShipmentStatus;
        carrier           : Association to Carriers;
        trackingNumber    : String(50);
        shippedAt         : Timestamp;
        estimatedDelivery : Timestamp;
        actualDelivery    : Timestamp;
        destinationCity   : String(80);
        destinationCountry: String(3);
        modifiedAt        : Timestamp;
        events            : Composition of many TrackingEvents on events.shipment = $self;
}

entity TrackingEvents {
    key ID        : UUID;
        shipment  : Association to Shipments;
        timestamp : Timestamp;
        eventType : String(30);
        location  : String(100);
        notes     : String(200);
}

// Write-receiver for `examples/04-move-to-service/`. The pipeline reads from
// a remote OData source and writes here via the built-in ODataTargetAdapter.
// Same shape as Shipments with a couple of provenance columns the target
// pipeline stamps on the way in.
entity ShipmentArchive {
    key ID                : UUID;
        orderId           : Integer;
        status            : ShipmentStatus;
        carrierCode       : String(10);
        trackingNumber    : String(50);
        shippedAt         : Timestamp;
        estimatedDelivery : Timestamp;
        actualDelivery    : Timestamp;
        destinationCity   : String(80);
        destinationCountry: String(3);
        modifiedAt        : Timestamp;
        archivedAt        : Timestamp;
}
