namespace archiveDev;

// Secondary SQLite target (ArchiveDb). @cds.persistence.skip keeps the primary
// in-memory `db` clean; server.js deploys this entity into ArchiveDb on boot.
@cds.persistence.skip
@cds.persistence.table
entity ShipmentArchive {
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
        archivedAt        : Timestamp;
}
