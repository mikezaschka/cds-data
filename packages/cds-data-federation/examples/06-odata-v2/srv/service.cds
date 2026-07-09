using { shop } from '../db/schema';

service ShopService {
    entity Customers as projection on shop.Customers;
    entity Products  as projection on shop.Products;
    entity Suppliers as projection on shop.Suppliers;
}
