using { ProviderService as remote } from '../srv/external/ProviderService';

namespace shop;

// ─── Live proxy — wildcard projection ───────────────────────────────────────

/** Live customer master. All remote fields, forwarded at request time. */
@federation.delegate
entity Customers as projection on remote.Customers;

// ─── Column restriction + field renames ─────────────────────────────────────

/**
 * Product catalog with a restricted, renamed shape.
 * Remote: ID, name, category, price, currency, stock, modifiedAt (7 fields)
 * Local:  productId, productName, category, unitPrice, currency   (5 fields)
 * `stock` and `modifiedAt` are never projected → never fetched.
 */
@federation.delegate
entity Products as projection on remote.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
};

// ─── Entity-level rename — same data, different domain ──────────────────────

/** The remote Customers reframed as local "Suppliers". */
@federation.delegate
entity Suppliers as projection on remote.Customers {
    ID      as supplierId,
    name    as companyName,
    city    as headquarters,
    country as region,
    email   as contactEmail
};

// ─── Static where — filter injected into every remote query ─────────────────

/** Only non-blocked customers. `$filter=blocked eq false` is added automatically. */
@federation.delegate
entity ActiveCustomers as projection on remote.Customers where blocked = false;

// ─── CUD opt-in — read-only by default ──────────────────────────────────────

/** Full CUD forwarded to the remote (writable: true). */
@federation.delegate: { writable: true }
entity WritableCustomers as projection on remote.Customers;

/** Selective writes: create + update allowed, delete rejected with 405. */
@federation.delegate: { create: true, update: true }
entity WritableCustomersNoDelete as projection on remote.Customers;
