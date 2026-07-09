using { ProviderService as remote } from '../srv/external/ProviderService';

namespace shop;

// The remote provider serves `@hcql @odata`. For CAP-to-CAP integration, CAP's
// remote client auto-selects HCQL over OData — no annotation change here.

/** Plain delegate — HCQL is chosen automatically on the wire. */
@federation.delegate
entity Customers as projection on remote.Customers excluding { orders };

@federation.delegate
entity Products as projection on remote.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
};

// ─── Flattened associations — the HCQL payoff ───────────────────────────────

/**
 * Path expressions like `customer.name` denormalize associated fields into a
 * flat projection. HCQL can express these; **OData cannot**. Against an
 * OData-only remote this projection fails; against `@hcql` it works.
 */
@federation.delegate
entity OrderFlat as projection on remote.Orders {
    ID            as orderId,
    customer.name as buyerName,
    product.name  as itemName,
    quantity,
    total         as amount,
    status
};
