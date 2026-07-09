using { ProviderService as remote } from '../srv/external/ProviderService';

namespace shop;

// ─── Scheduled sync into the local database ─────────────────────────────────

/**
 * Full copy of the remote customers into a local SQLite table.
 * `preload: true` runs one full replicate at server startup (background,
 * non-blocking) so the table is populated on first boot. The `orders`
 * association points back to the remote and is excluded from the local copy.
 */
@federation.replicate: { preload: true }
entity ReplicatedCustomers as projection on remote.Customers excluding { orders };

/**
 * Column restriction + renames, refreshed incrementally.
 * `delta.field: 'modifiedAt'` makes each scheduled run pull only rows changed
 * since the last watermark. `schedule` is an interval in ms (10 minutes).
 */
@federation.replicate: { schedule: 600000, delta: { field: 'modifiedAt' } }
entity ReplicatedProducts as projection on remote.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
};

// ─── Local SQL over the replicated tables (offline analytics) ───────────────

/** A plain SQL view over the local replica — impossible with a live proxy. */
@readonly
entity ExpensiveProducts as projection on ReplicatedProducts {
    productId,
    productName,
    category,
    unitPrice,
    currency
} where unitPrice > 100;

/** Aggregate rollup computed locally with GROUP BY. */
@readonly
entity CategoryStats as select from ReplicatedProducts {
    category,
    count(*)       as productCount : Integer,
    avg(unitPrice) as avgPrice     : Decimal(9, 4)
} group by category;
