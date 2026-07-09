using { ProviderService as remote } from '../srv/external/ProviderService';

namespace example;

// ─── Delegate: live proxy to remote OData provider ───────────────────────────

/** Live customer master from the remote ProviderService. */
@federation.delegate
entity Customers as projection on remote.Customers;

/**
 * Product catalog with local field renames.
 * Remote: ID, name, category, price, currency, stock, modifiedAt
 * Local:  productId, productName, category, unitPrice, currency
 */
@federation.delegate
entity Products as projection on remote.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
};

// ─── Replicate: local SQLite copy (fed by cds-data-pipeline) ─────────────────

/**
 * Customers copied into local DB for offline SQL / joins. Excludes remote-only orders nav.
 * `preload` runs a full replicate at server startup (background, non-blocking) so the
 * local table is populated on first boot without any bootstrap code.
 */
@federation.replicate: { preload: true }
entity ReplicatedCustomers as projection on remote.Customers excluding { orders };
