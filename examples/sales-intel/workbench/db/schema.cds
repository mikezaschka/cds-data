using { northwind_v4_metadata as nw }  from '../srv/external/northwind-v4-metadata';
using { northwind_v2_metadata as nwV2 } from '../srv/external/northwind-v2-metadata';
using { LogisticsService as logistics } from '../srv/external/LogisticsService';

namespace workbench;

// ─── Local entities ───────────────────────────────────────────────────────────
// These are the rows sales reps actually author. Everything else in this file
// is a projection on a remote service.

entity CustomerNotes {
    key ID        : UUID;
        customer  : Association to Customers;      // → Northwind V4
        author    : String(100);
        note      : String(500);
        createdAt : Timestamp;
}

entity FollowUpTasks {
    key ID        : UUID;
        customer  : Association to Customers;      // → Northwind V4
        order     : Association to Orders;         // → Northwind V4 (optional)
        dueOn     : Date;
        title     : String(200);
        done      : Boolean default false;
        createdAt : Timestamp;
}

entity CustomerRiskRatings {
    key ID       : UUID;
        customer : Association to Customers;       // → Northwind V4
        rating   : Integer;                        // 1 (low) .. 5 (high)
        reason   : String(500);
        setBy    : String(100);
        setAt    : Timestamp;
}

entity ShipmentAlerts {
    key ID        : UUID;
        shipment  : Association to Shipments;      // → LogisticsService (CAP)
        severity  : String(10);                    // info | warning | critical
        message   : String(500);
        createdAt : Timestamp;
}


// ─── Northwind V4 — delegated (live lookups) ──────────────────────────────────

// Wildcard-ish projection with local-only backlinks.
// Demonstrates: V4 delegation, plus cross-service expand: remote → local for
// `notes`, `tasks`, `risk` against the local DB when the client asks for them.
@federation.delegate
entity Customers as projection on nw.Customers {
    CustomerID  as customerId,
    CompanyName as companyName,
    ContactName as contactName,
    ContactTitle as contactTitle,
    City        as city,
    Country     as country,
    Phone       as phone,

    notes : Association to many CustomerNotes       on notes.customer = $self,
    tasks : Association to many FollowUpTasks       on tasks.customer = $self,
    risk  : Association to one  CustomerRiskRatings on risk.customer  = $self
};

// Static `where` projection — plugin feature (CAP alone rejects this for
// delegate entities). Every query against ActiveCustomers adds the filter.
// Customers without a region set are treated as HQ/direct accounts.
@federation.delegate
entity ActiveCustomers as projection on nw.Customers {
    CustomerID  as customerId,
    CompanyName as companyName,
    City        as city,
    Country     as country
} where Country != 'Mexico';

// Orders with renamed association → enables delegated expand (remote→remote)
// via $expand=lineItems. Association renames let the client speak the local
// vocabulary; the plugin translates `lineItems` back to `Order_Details` on the
// wire.
@federation.delegate
entity Orders as projection on nw.Orders {
    OrderID       as orderId,
    CustomerID    as customerId,
    EmployeeID    as employeeId,
    OrderDate     as orderDate,
    RequiredDate  as requiredDate,
    ShippedDate   as shippedDate,
    Freight       as freight,
    ShipCountry   as shipCountry,
    ShipCity      as shipCity,
    Customer      as buyer,
    Employee      as salesRep,
    Order_Details as lineItems
};

@federation.delegate
entity Employees as projection on nw.Employees {
    EmployeeID as employeeId,
    FirstName  as firstName,
    LastName   as lastName,
    Title      as title,
    Country    as country
};


// ─── Northwind V2 — delegated with field renames ──────────────────────────────
// Framing: a legacy product-catalog system. Same rows as V4, accessed via V2
// with PascalCase shape. The consumption view modernises the field names.
@federation.delegate
entity Products as projection on nwV2.Products {
    ProductID       as productId,
    ProductName     as productName,
    CategoryID      as categoryId,
    QuantityPerUnit as packSize,
    UnitPrice       as unitPrice,
    UnitsInStock    as inStock,
    Discontinued    as discontinued
};


// ─── LogisticsService (local CAP app) — delegated ─────────────────────────────

// Wildcard projection. Shipments.orderId is a plain integer that matches
// Northwind Orders/OrderID — the Customer 360 and Order Tracker tiles use this
// to stitch shipment info into order detail views.
@federation.delegate
entity Shipments as projection on logistics.Shipments;

// Artificially slow on the provider side (2 s sleep in the CAP handler).
// The cache option makes the first request pay the 2 s cost and every
// subsequent request return from cache in milliseconds until the TTL expires.
// Open the browser network panel and watch the latency collapse.
@federation.delegate: { cache: { ttl: 300000 } }
entity Carriers as projection on logistics.Carriers;

@federation.delegate
entity TrackingEvents as projection on logistics.TrackingEvents;


// ─── Northwind V4 — replicated (analytics + reference data) ───────────────────

// Reference data — slow-changing, joined into dashboards. No modifiedAt on
// Northwind Categories, so this is a full refresh on every run.
@federation.replicate
entity Categories as projection on nw.Categories {
    CategoryID   as categoryId,
    CategoryName as categoryName,
    Description  as description
};

// Same remote entity as the delegated `Orders` above — but replicated here as
// the header table for the Sales Analytics ALP. This is the plan's core
// teaching moment: the SAME remote data serves BOTH a live-lookup view and an
// analytical view, with different federation strategies.
@federation.replicate
entity SalesOrders as projection on nw.Orders {
    OrderID     as orderId,
    CustomerID  as customerId,
    EmployeeID  as employeeId,
    OrderDate   as orderDate,
    ShippedDate as shippedDate,
    Freight     as freight,
    ShipCountry as shipCountry
};

// Order line items — required for the ALP revenue aggregation
// (sum(UnitPrice * Quantity * (1 - Discount))).
@federation.replicate
entity SalesOrderLines as projection on nw.Order_Details {
    OrderID   as orderId,
    ProductID as productId,
    UnitPrice as unitPrice,
    Quantity  as quantity,
    Discount  as discount
};

// Product dimension for the ALP — links line items to a category name.
@federation.replicate
entity SalesProducts as projection on nw.Products {
    ProductID   as productId,
    ProductName as productName,
    CategoryID  as categoryId,
    UnitPrice   as listPrice,
    Discontinued as discontinued
};


// ─── FXService (local REST app) — replicated via REST adapter ─────────────────

// Explicit REST source: the FX service has no CDS model, so the plugin cannot
// infer the shape from a projection. The entity is declared locally and the
// annotation points at a plain HTTP endpoint with offset pagination and a
// `modifiedSince` delta parameter.
@cds.persistence.table
@cds.persistence.skip: false
@federation.replicate: {
    source: 'FXService',
    delta: { field: 'modifiedAt' },
    rest: {
        path: '/api/rates',
        pagination: { type: 'offset', pageSize: 100 },
        deltaParam: 'modifiedSince',
        dataPath: 'results'
    }
}
entity ExchangeRates {
    key ID            : String(30);
        baseCurrency  : String(3);
        quoteCurrency : String(3);
        rate          : Decimal(10, 4);
        rateDate      : Date;
        modifiedAt    : Timestamp;
}
