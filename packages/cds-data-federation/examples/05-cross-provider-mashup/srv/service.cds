using { shop } from '../db/schema';

service ShopService {
    entity Products         as projection on shop.Products;
    entity Warehouses       as projection on shop.Warehouses;
    entity StockLevels      as projection on shop.StockLevels;
    entity InventoryReports as projection on shop.InventoryReports;
}
