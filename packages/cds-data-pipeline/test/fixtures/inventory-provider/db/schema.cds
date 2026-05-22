namespace inventory;

entity Warehouses {
    key ID       : String(10);
        name     : String(100);
        location : String(100);
        capacity : Integer;
}

entity StockLevels {
    key ID          : String(10);
        product_ID  : String(10);
        warehouse   : Association to Warehouses;
        quantity    : Integer;
        lastCounted : Timestamp;
}

/**
 * Writable OData target for move-to-service pipeline tests (no @readonly).
 */
entity MirroredCustomers {
    key ID         : String(10);
        name       : String(100);
        city       : String(50);
        country    : String(3);
        email      : String(100);
        blocked    : Boolean default false;
        modifiedAt : Timestamp;
}
