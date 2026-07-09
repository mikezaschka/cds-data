using { shop } from '../db/schema';

service ShopService {
    entity CachedCustomers       as projection on shop.CachedCustomers;
    entity CachedProducts        as projection on shop.CachedProducts;
    entity EntityCachedCustomers as projection on shop.EntityCachedCustomers;
}
