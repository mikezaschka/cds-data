using { plugin.data_federation as federation } from 'cds-data-federation';
using { ProviderService as remote } from '../srv/external/ProviderService';
using { ProviderServiceV2 as remoteV2 } from '../srv/external/ProviderServiceV2';
using { InventoryService as inv } from '../srv/external/InventoryService';
using { northwind_v4_metadata as nw } from '../srv/external/northwind-v4-metadata';
using { northwind_v2_metadata as nwV2 } from '../srv/external/northwind-v2-metadata';

namespace consumer;

// ─── Local entities ────────────────────────────────────────────────────────────

entity Reviews {
    key ID        : UUID;
        product   : Association to Products;    // Association to remote Products
        rating    : Integer;
        comment   : String(500);
        author    : String(100);
        createdAt : Timestamp;
}

entity Bookmarks {
    key ID       : UUID;
        customer : Association to Customers;    // Association to remote Customers
        label    : String(100);
}

entity InventoryReports {
    key ID        : UUID;
        product   : Association to Products;    // Association to remote Products
        warehouse : Association to Warehouses;    // Association to remote Warehouses
        note      : String(500);
        createdAt : Timestamp;
}

entity LightBookmarks {
    key ID       : UUID;
        customer : Association to CustomersLight;
        label    : String(100);
}

entity AddressNotes {
    key ID      : UUID;
        address : Association to CustomerAddresses;
        note    : String(500);
}

entity ProductCategories {
    key category    : String(50);
        description : String(200);
        products    : Association to many Products on products.category = $self.category;
}

// ─── Consumption views: OData V4 (delegate) ─────────────────────────────────

// Wildcard projection + local backlink for Scenario C (remote→local expand).
// The `*` projects all remote fields; `bookmarks` is a local-only to-many association.
// writable: true enables CREATE/UPDATE/DELETE forwarding to the remote service.
@federation.delegate: { writable: true }
entity Customers as projection on remote.Customers {
    *,
    bookmarks : Association to many Bookmarks on bookmarks.customer = $self
};

// Column restriction + renames: tests column extraction and rename mapping
// Remote fields: ID, name, category, price, currency, stock, modifiedAt
// Local fields:  productId, productName, category, unitPrice, currency (5 of 7)
// writable: true enables CREATE/UPDATE/DELETE forwarding to the remote service.
@federation.delegate: { writable: true }
entity Products as projection on remote.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
};

// Field + association renames: enables Scenario A (remote→remote) expand tests
// Renames both scalar fields and association names
@federation.delegate
entity Orders as projection on remote.Orders {
    ID        as orderId,
    customer  as buyer,
    product   as item,
    quantity,
    total     as amount,
    status,
    orderDate as placedOn,
    modifiedAt
};

// Entity-level rename: reframes remote "Customers" as local "Suppliers"
// Same remote data, completely different local domain purpose.
@federation.delegate
entity Suppliers as projection on remote.Customers {
    ID      as supplierId,
    name    as companyName,
    city    as headquarters,
    country as region,
    email   as contactEmail
};

// Selective write flags: create + update enabled, delete disabled.
// Tests that individual flags override the default (all false).
@federation.delegate: { create: true, update: true }
entity WritableCustomersNoDelete as projection on remote.Customers { * };

// Composite key entity with renames — tests multi-key association in Scenario B
@federation.delegate
entity CustomerAddresses as projection on remote.Addresses {
    customerID as custId,
    type       as addressType,
    street,
    city,
    zipCode    as zip
};

// Server-paged delegate: remote caps every response at 2 rows (via @cds.query.limit).
// Used to test transparent auto-paging through the delegate handler.
@federation.delegate
entity PagedCustomers as projection on remote.PagedCustomers;

// ─── Consumption views: OData V2 (delegate) ─────────────────────────────────

// Same provider data accessed via OData V2 protocol
@federation.delegate
entity CustomersV2 as projection on remoteV2.Customers;

// Same renames as Products but via V2 — tests that CAP handles V2 translation
@federation.delegate
entity ProductsV2 as projection on remoteV2.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
};

// V2 Orders with same renames as V4 — tests $expand Scenario A via V2
@federation.delegate
entity OrdersV2 as projection on remoteV2.Orders {
    ID        as orderId,
    customer  as buyer,
    product   as item,
    quantity,
    total     as amount,
    status,
    orderDate as placedOn,
    modifiedAt
};

// V2 Suppliers: entity-level rename via V2 protocol
@federation.delegate
entity SuppliersV2 as projection on remoteV2.Customers {
    ID      as supplierId,
    name    as companyName,
    city    as headquarters,
    country as region,
    email   as contactEmail
};

// ─── Consumption view patterns ───────────────────────────────────────────────

// PATTERN: excluding — remove specific fields from wildcard projection
// Tests REQUIREMENTS.md 4.1.5. CAP should restrict $select to exclude these fields.
@federation.delegate
entity CustomersLight as projection on remote.Customers excluding { email, modifiedAt };

// PATTERN: where condition — static filter applied to every query
// Every READ on ActiveCustomers should automatically add $filter=blocked eq false
@federation.delegate
entity ActiveCustomers as projection on remote.Customers where blocked = false;

// PATTERN: where + column restriction + renames
// Static filter on remote field name + renames. Only Electronics products returned.
@federation.delegate
entity ElectronicsProducts as projection on remote.Products {
    ID    as productId,
    name  as productName,
    price as unitPrice,
    currency
} where category = 'Electronics';

// PATTERN: flatten association (OData limitation test)
// CaLeSi docs: "OData doesn't support denormalization."
// Path expressions like `customer.name as buyerName` work with HCQL but NOT OData.
@federation.delegate
entity OrderFlat as projection on remote.Orders {
    ID            as orderId,
    customer.name as buyerName,
    product.name  as itemName,
    quantity,
    total         as amount,
    status
};

// PATTERN: local view navigating to remote association
// A projection on a LOCAL entity (Reviews) that navigates through an association
// to a REMOTE entity (Products) and flattens the result.
// This is Scenario B with automatic flattening rather than explicit $expand.
// @cds.persistence.skip required because Products is a delegate entity (skip=true)
// and the compiler cannot generate SQL for path expressions through skipped targets.
@cds.persistence.skip
entity ReviewsEnriched as projection on Reviews {
    ID,
    comment,
    rating,
    author,
    product.productId   as productId,
    product.productName as productName,
    product.category    as productCategory
};

// ─── Consumption views: Inventory provider (delegate) ────────────────────────

@federation.delegate
entity Warehouses as projection on inv.Warehouses;

@federation.delegate
entity StockLevels as projection on inv.StockLevels {
    ID         as stockId,
    product_ID as productRef,
    warehouse,
    quantity   as onHand,
    lastCounted
};

// ─── Local entity for Northwind cross-service tests ──────────────────────────

entity NwProductNotes {
    key ID      : Integer;
        product : Association to NwProducts;
        note    : String(500);
        author  : String(100);
}

// ─── Consumption views: Northwind V4 (delegate) ─────────────────────────────

@federation.delegate
entity NwProducts as projection on nw.Products {
    ProductID    as productId,
    ProductName  as productName,
    UnitPrice    as unitPrice,
    Discontinued as discontinued,
    Category     as category,
    notes : Association to many NwProductNotes on notes.product = $self
};

@federation.delegate
entity NwCategories as projection on nw.Categories {
    CategoryID   as categoryId,
    CategoryName as categoryName,
    Description  as description,
    Products     as products
};

@federation.delegate
entity NwCustomers as projection on nw.Customers {
    CustomerID  as customerId,
    CompanyName as companyName,
    ContactName as contactName,
    City        as city,
    Country     as country
};

// ─── Consumption views: Northwind V2 (delegate) ─────────────────────────────

@federation.delegate
entity NwCustomersV2 as projection on nwV2.Customers {
    CustomerID  as customerId,
    CompanyName as companyName,
    ContactName as contactName,
    City        as city,
    Country     as country
};

// ─── Consumption views: Replicate strategy ───────────────────────────────────

// Wildcard projection — replicate all customer fields to local DB.
// Exclude `orders` association: it points back to remote ProviderService.Customers
// which cannot be resolved in a local persistence table.
@federation.replicate
entity ReplicatedCustomers as projection on remote.Customers excluding { orders };

// Column restriction + renames — tests that MAP phase applies viewMapping renames.
// Remote: ID, name, category, price, currency, stock, modifiedAt (7 fields)
// Local: productId, productName, category, unitPrice, currency (5 fields)
@federation.replicate: { delta: { field: 'modifiedAt' } }
entity ReplicatedProducts as projection on remote.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
};

// Server-paged replicate: remote caps every response at 2 rows (via @cds.query.limit).
// Requesting batchSize=100 per page still produces only 2 rows per request — the adapter
// must keep paging until the remote returns empty in order to capture all 5 rows.
@federation.replicate: { batchSize: 100 }
entity ReplicatedPagedCustomers as projection on remote.PagedCustomers excluding { orders };

// ─── Consumption views: REST Replicate strategy ─────────────────────────────

// REST source — explicit service name, no CDS model/projection inference.
// Replicates customers from a plain REST API via srv.send().
@cds.persistence.table
@cds.persistence.skip: false
@federation.replicate: {
    source: 'RestProvider',
    delta: { field: 'modifiedAt' },
    rest: {
        path: '/api/customers',
        pagination: { type: 'offset', pageSize: 100 },
        deltaParam: 'modifiedSince',
        dataPath: 'results'
    }
}
entity ReplicatedRestCustomers {
    key ID      : String(10);
        name    : String(100);
        city    : String(50);
        country : String(3);
        email   : String(100);
        blocked : Boolean default false;
        modifiedAt : Timestamp;
};

// ─── Cached consumption views ───────────────────────────────────────────────

@federation.delegate: { cache: { ttl: 5000 } }
entity CachedCustomers as projection on remote.Customers;

@federation.delegate: { cache: { ttl: 10000, tags: ['product-cache'] } }
entity CachedProducts as projection on remote.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
};

@federation.delegate: { cache: { ttl: 10000, service: 'longTermCache', tags: [{ data: 'orderId', prefix: 'order-' }, { value: 'order-data' }] } }
entity CachedOrders as projection on remote.Orders {
    ID        as orderId,
    customer  as buyer,
    product   as item,
    quantity,
    total     as amount,
    status,
    orderDate as placedOn,
    modifiedAt
};
