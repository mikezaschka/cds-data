using { shop } from '../db/schema';

service ShopService {
    entity Customers                 as projection on shop.Customers;
    entity Products                  as projection on shop.Products;
    entity Suppliers                 as projection on shop.Suppliers;
    entity ActiveCustomers           as projection on shop.ActiveCustomers;
    entity WritableCustomers         as projection on shop.WritableCustomers;
    entity WritableCustomersNoDelete as projection on shop.WritableCustomersNoDelete;
}
