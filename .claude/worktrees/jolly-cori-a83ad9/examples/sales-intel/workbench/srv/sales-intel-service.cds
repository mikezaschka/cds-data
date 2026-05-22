using { workbench } from '../db/schema';

service SalesIntelService @(path: '/odata/v4/sales-intel') {

    // ─── Delegated — Northwind V4 ─────────────────────────────────────────────
    @cds.redirection.target
    entity Customers       as projection on workbench.Customers;

    @cds.redirection.target: false
    entity ActiveCustomers as projection on workbench.ActiveCustomers;
    entity Orders          as projection on workbench.Orders;
    entity Employees       as projection on workbench.Employees;

    // ─── Delegated — Northwind V2 (legacy product catalog) ────────────────────
    entity Products        as projection on workbench.Products;

    // ─── Delegated — LogisticsService (local CAP, V4) ─────────────────────────
    entity Shipments       as projection on workbench.Shipments;
    entity Carriers        as projection on workbench.Carriers;
    entity TrackingEvents  as projection on workbench.TrackingEvents;

    // ─── Replicated — Northwind V4 (reference + analytics) ────────────────────
    // Override @cds.persistence.skip inherited from the remote projection so the
    // replicated local table is served by OData.
    @cds.persistence.skip: false
    entity Categories       as projection on workbench.Categories;

    @cds.persistence.skip: false
    entity SalesOrders      as projection on workbench.SalesOrders;

    @cds.persistence.skip: false
    entity SalesOrderLines  as projection on workbench.SalesOrderLines;

    @cds.persistence.skip: false
    entity SalesProducts    as projection on workbench.SalesProducts;

    // ─── Replicated — FXService (REST) ────────────────────────────────────────
    entity ExchangeRates   as projection on workbench.ExchangeRates;

    // ─── Local — sales-rep authored content ───────────────────────────────────
    entity CustomerNotes        as projection on workbench.CustomerNotes;
    entity FollowUpTasks        as projection on workbench.FollowUpTasks;
    entity CustomerRiskRatings  as projection on workbench.CustomerRiskRatings;
    entity ShipmentAlerts       as projection on workbench.ShipmentAlerts;
}
