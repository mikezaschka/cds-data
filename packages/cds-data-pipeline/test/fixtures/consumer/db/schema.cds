using from 'cds-data-pipeline/db';
using { ProviderService } from '../../provider/srv/provider-service';

namespace consumer;

using { plugin.data_pipeline.sourced } from 'cds-data-pipeline/db';

/** Consumption view used to test CSN-inferred viewMapping (no explicit viewMapping in addPipeline). */
@cds.persistence.table
entity InferredViewProducts as projection on ProviderService.Products {
    ID       as productId,
    name     as productName,
    category,
    price    as unitPrice,
    currency,
};

entity ReplicatedCustomers {
    key ID         : String(10);
        name       : String(100);
        city       : String(50);
        country    : String(3);
        email      : String(100);
        blocked    : Boolean default false;
        modifiedAt : Timestamp;
}

entity ReplicatedCustomersV2 {
    key ID         : String(10);
        name       : String(100);
        city       : String(50);
        country    : String(3);
        email      : String(100);
        blocked    : Boolean default false;
        modifiedAt : Timestamp;
}

entity ReplicatedProducts {
    key productId   : String(10);
        productName : String(100);
        category    : String(50);
        unitPrice   : Decimal(10,2);
        currency    : String(3);
}

entity ReplicatedPagedCustomers {
    key ID         : String(10);
        name       : String(100);
        city       : String(50);
        country    : String(3);
        email      : String(100);
        blocked    : Boolean default false;
        modifiedAt : Timestamp;
}

entity ReplicatedRestCustomers {
    key ID         : String(10);
        name       : String(100);
        city       : String(50);
        country    : String(3);
        email      : String(100);
        blocked    : Boolean default false;
        modifiedAt : Timestamp;
}

entity SourceOrders {
    key ID         : String(36);
        customerId : String(10);
        amount     : Decimal(10,2);
        status     : String(20);
        orderedAt  : Timestamp;
        modifiedAt : Timestamp;
}

entity ReplicatedSourceOrders {
    key ID         : String(36);
        customerId : String(10);
        amount     : Decimal(10,2);
        status     : String(20);
        orderedAt  : Timestamp;
        modifiedAt : Timestamp;
}

entity DailyCustomerRevenue {
    key customerId   : String(10);
        totalAmount  : Decimal(15,2);
        orderCount   : Integer;
        lastActivity : Timestamp;
}

/** ADR 0008 — compound key (source, ID) for multi-origin fan-in tests */
entity FanInCustomers : sourced {
    key ID         : String(10);
        name       : String(100);
        city       : String(50);
        country    : String(3);
        email      : String(100);
        blocked    : Boolean default false;
        modifiedAt : Timestamp;
}
