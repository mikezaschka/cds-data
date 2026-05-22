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
