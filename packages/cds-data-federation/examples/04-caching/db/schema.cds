using { ProviderService as remote } from '../srv/external/ProviderService';

namespace shop;

// ─── Response cache (cds-caching) ───────────────────────────────────────────
// Keyed by the exact query signature ($filter/$select/$orderby/$top/$skip).
// A repeated identical query is served from cache until TTL expires.

@federation.delegate: { cache: { ttl: 30000 } }
entity CachedCustomers as projection on remote.Customers;

/** Custom tag for surgical invalidation via `cache.deleteByTag('product-cache')`. */
@federation.delegate: { cache: { ttl: 30000, tags: ['product-cache'] } }
entity CachedProducts as projection on remote.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
};

// ─── Entity cache (SQLite snapshot via cds-data-pipeline) ───────────────────
// Warms a full local snapshot on first miss; then answers ANY filter/orderby
// from SQLite until TTL — unlike response cache, the query need not be identical.

@federation.delegate: { cache: { strategy: 'entity', ttl: 60000, batchSize: 500 } }
entity EntityCachedCustomers as projection on remote.Customers;
