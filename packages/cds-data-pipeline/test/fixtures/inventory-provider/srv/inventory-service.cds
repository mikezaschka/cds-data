using { inventory } from '../db/schema';

service InventoryService {
    @readonly
    entity Warehouses  as projection on inventory.Warehouses;
    @readonly
    entity StockLevels as projection on inventory.StockLevels;

    entity MirroredCustomers as projection on inventory.MirroredCustomers;
}
