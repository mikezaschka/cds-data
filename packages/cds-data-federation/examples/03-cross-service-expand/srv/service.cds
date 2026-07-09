using { shop } from '../db/schema';

service ShopService {
    entity Customers as projection on shop.Customers;
    entity Products  as projection on shop.Products;
    entity Reviews   as projection on shop.Reviews;
    entity Bookmarks as projection on shop.Bookmarks;
}
