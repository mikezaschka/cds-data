namespace provider;

entity Customers {
    key ID       : String(10);
        name     : String(100);
        city     : String(50);
        country  : String(3);
        email    : String(100);
        blocked  : Boolean default false;
        modifiedAt : Timestamp;
        orders   : Association to many Orders on orders.customer = $self;
}

entity Products {
    key ID       : String(10);
        name     : String(100);
        category : String(50);
        price    : Decimal(10,2);
        currency : String(3) default 'EUR';
        stock    : Integer;
        modifiedAt : Timestamp;
}

entity Orders {
    key ID       : String(36);
        customer : Association to Customers;
        product  : Association to Products;
        quantity : Integer;
        total    : Decimal(10,2);
        status   : String(20) default 'open';
        orderDate : Date;
        modifiedAt : Timestamp;
}

entity Addresses {
    key customerID : String(10);
    key type       : String(20);
        street     : String(200);
        city       : String(50);
        zipCode    : String(10);
}
