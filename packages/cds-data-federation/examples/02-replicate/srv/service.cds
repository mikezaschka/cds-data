using { shop } from '../db/schema';

service ShopService {
    entity ReplicatedCustomers        as projection on shop.ReplicatedCustomers;
    entity ReplicatedProducts         as projection on shop.ReplicatedProducts;
    @readonly entity ExpensiveProducts as projection on shop.ExpensiveProducts;
    @readonly entity CategoryStats     as projection on shop.CategoryStats;
}
