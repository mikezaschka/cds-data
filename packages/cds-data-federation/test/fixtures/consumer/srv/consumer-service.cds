using { consumer } from '../db/schema';
using from 'cds-data-pipeline/srv/DataPipelineManagementService';

service ConsumerService {

    // Federated entities: OData V4 provider
    @cds.redirection.target
    entity Customers as projection on consumer.Customers;
    @cds.redirection.target
    entity Products  as projection on consumer.Products;
    @cds.redirection.target
    entity Orders    as projection on consumer.Orders;
    entity Suppliers as projection on consumer.Suppliers;

    // Selective write test entity (create + update, no delete)
    entity WritableCustomersNoDelete as projection on consumer.WritableCustomersNoDelete;

    // Federated entities: OData V2 provider (same data, different protocol)
    @cds.redirection.target
    entity CustomersV2  as projection on consumer.CustomersV2;
    entity ProductsV2   as projection on consumer.ProductsV2;
    entity OrdersV2     as projection on consumer.OrdersV2;
    entity SuppliersV2  as projection on consumer.SuppliersV2;

    // Federated entities: Inventory provider (second OData V4 service)
    entity Warehouses  as projection on consumer.Warehouses;
    entity StockLevels as projection on consumer.StockLevels;

    // Consumption view pattern tests
    entity CustomersLight       as projection on consumer.CustomersLight;
    entity ActiveCustomers      as projection on consumer.ActiveCustomers;
    entity ElectronicsProducts  as projection on consumer.ElectronicsProducts;
    entity OrderFlat            as projection on consumer.OrderFlat;
    entity ReviewsEnriched      as projection on consumer.ReviewsEnriched;

    // Higher-level flattened view: service projection on delegate entity with path expressions
    // 2-level chain: OrderSummary → consumer.Orders → remote.Orders
    // Path expressions use REMOTE field names because CDS resolves through to the target entity.
    entity OrderSummary as projection on consumer.Orders {
        orderId,
        buyer.name  as buyerName,
        item.name   as itemName,
        quantity,
        amount,
        status
    };

    // Federated entities: Northwind V4 (real external service)
    entity NwProducts     as projection on consumer.NwProducts;
    entity NwCategories   as projection on consumer.NwCategories;
    entity NwCustomers    as projection on consumer.NwCustomers;
    entity NwProductNotes as projection on consumer.NwProductNotes;

    // Federated entities: Northwind V2 (real external service)
    entity NwCustomersV2  as projection on consumer.NwCustomersV2;

    // Cached delegate entities
    entity EntityCachedCustomers as projection on consumer.EntityCachedCustomers;
    entity CachedCustomers as projection on consumer.CachedCustomers;
    entity CachedProducts  as projection on consumer.CachedProducts;
    entity CachedOrders    as projection on consumer.CachedOrders;

    // Replicated entities (local tables fed by replication)
    entity ReplicatedCustomers as projection on consumer.ReplicatedCustomers;
    entity ReplicatedProducts  as projection on consumer.ReplicatedProducts;
    entity AvailableProducts   as projection on consumer.AvailableProducts;
    entity CategoryStats       as projection on consumer.CategoryStats;

    // CQN adapter test entities (local source + replicate / materialize targets)
    entity SourceOrders            as projection on consumer.SourceOrders;
    entity ReplicatedSourceOrders  as projection on consumer.ReplicatedSourceOrders;
    entity DailyCustomerRevenue    as projection on consumer.DailyCustomerRevenue;

    // Composite key delegate entity
    entity CustomerAddresses as projection on consumer.CustomerAddresses;

    // Server-paged delegate + replicate entities (remote caps at 2 rows/page)
    entity PagedCustomers          as projection on consumer.PagedCustomers;
    entity ReplicatedPagedCustomers as projection on consumer.ReplicatedPagedCustomers;

    // Local entities (with associations to federated entities)
    entity Reviews            as projection on consumer.Reviews;
    entity Bookmarks          as projection on consumer.Bookmarks;
    entity LightBookmarks     as projection on consumer.LightBookmarks;
    entity AddressNotes       as projection on consumer.AddressNotes;
    entity ProductCategories  as projection on consumer.ProductCategories;
    entity InventoryReports   as projection on consumer.InventoryReports;
}
