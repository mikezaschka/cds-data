using { ProviderService as remote } from '../srv/external/ProviderService';

namespace shop;

// ─── Remote entities (delegate) ─────────────────────────────────────────────

/**
 * Remote customers, with a **local** backlink to Bookmarks.
 * The `bookmarks` association enables cross-service expand: remote → local
 * (`GET Customers?$expand=bookmarks`), stitched from the local DB.
 */
@federation.delegate
entity Customers as projection on remote.Customers {
    *,
    bookmarks : Association to many Bookmarks on bookmarks.customer = $self
};

/** Remote product catalog (renamed). */
@federation.delegate
entity Products as projection on remote.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
};

// ─── Local entities associating to remote ──────────────────────────────────

/** Local reviews. `product` navigates to the remote Products (local → remote expand). */
entity Reviews {
    key ID      : UUID;
        product : Association to Products;
        rating  : Integer;
        comment : String(500);
        author  : String(100);
}

/** Local bookmarks. `customer` navigates to the remote Customers. */
entity Bookmarks {
    key ID       : UUID;
        customer : Association to Customers;
        label    : String(100);
}
