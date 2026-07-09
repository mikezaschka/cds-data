using { ProviderServiceV2 as remote } from '../srv/external/ProviderServiceV2';

namespace shop;

// Same consumption-view contract as OData V4 — only the remote protocol differs.
// CAP translates CQN to OData V2 and normalizes V2 quirks (string decimals,
// string $count) transparently through the delegate handler.

/** Live proxy over a legacy OData V2 service. */
@federation.delegate
entity Customers as projection on remote.Customers;

/** Column restriction + renames via V2. */
@federation.delegate
entity Products as projection on remote.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
};

/** Entity-level rename via V2 — legacy "Customers" reframed as "Suppliers". */
@federation.delegate
entity Suppliers as projection on remote.Customers {
    ID      as supplierId,
    name    as companyName,
    city    as headquarters,
    country as region,
    email   as contactEmail
};
