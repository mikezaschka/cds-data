using { ProviderService as remote } from '../srv/external/ProviderService';
using { InventoryService as inv } from '../srv/external/InventoryService';

namespace shop;

// ─── Provider A: product catalog (OData V4) ─────────────────────────────────

@federation.delegate
entity Products as projection on remote.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
};

// ─── Provider B: warehouse / stock (a different OData V4 service) ───────────

@federation.delegate
entity Warehouses as projection on inv.Warehouses;

@federation.delegate
entity StockLevels as projection on inv.StockLevels {
    ID         as stockId,
    product_ID as productRef,
    warehouse,
    quantity   as onHand,
    lastCounted
};

// ─── Local entity linking BOTH remote providers ─────────────────────────────

/**
 * `product` points to provider A, `warehouse` to provider B.
 * `$expand=product,warehouse` triggers one batch-fetch per provider,
 * then stitches both remote result sets onto the local rows.
 */
entity InventoryReports {
    key ID        : UUID;
        product   : Association to Products;
        warehouse : Association to Warehouses;
        note      : String(500);
}
