using { logistics } from '../db/schema';

service LogisticsService @(path: '/odata/v4/logistics') {

    @readonly
    entity Carriers  as projection on logistics.Carriers;

    @readonly
    entity Shipments as projection on logistics.Shipments;

    @readonly
    entity TrackingEvents as projection on logistics.TrackingEvents;

    // Writeable archive target for `examples/04-move-to-service/`.
    // Exposed without @readonly so the remote ODataTargetAdapter can POST /
    // PATCH / DELETE rows through CAP's connected-service runtime.
    entity ShipmentArchive as projection on logistics.ShipmentArchive;

    /**
     * Test-only events for file-based messaging (example 07). Topic FQNs must
     * stay in sync with lib/event-topics.js.
     */
    @topic: 'logistics.LogisticsService.ShipmentKeyTest'
    event ShipmentKeyTest {
        ID : UUID;
    }

    @topic: 'logistics.LogisticsService.ShipmentPayloadTest'
    event ShipmentPayloadTest {
        ID                 : UUID;
        orderId            : Integer;
        status             : logistics.ShipmentStatus;
        carrier_code       : String(10);
        trackingNumber     : String(50);
        shippedAt          : Timestamp;
        estimatedDelivery  : Timestamp;
        actualDelivery     : Timestamp;
        destinationCity    : String(80);
        destinationCountry : String(3);
        modifiedAt         : Timestamp;
    }

    action emitShipmentKeyTest(ID : UUID)     returns { ok : Boolean; };
    action emitShipmentPayloadTest(ID : UUID) returns { ok : Boolean; };
}
