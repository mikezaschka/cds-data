using { provider } from '../db/schema';

@odata @hcql
service ProviderService {
    @cds.redirection.target
    entity Customers as projection on provider.Customers;
    entity Products  as projection on provider.Products;
    entity Orders    as projection on provider.Orders;
    entity Addresses as projection on provider.Addresses;

    // Server-enforced page cap (max 2 rows per request) used by pagination tests
    // to simulate Northwind-style server-driven paging where the remote truncates
    // a requested $top.
    @cds.query.limit: { max: 2 }
    @cds.redirection.target: false
    entity PagedCustomers as projection on provider.Customers;
}
