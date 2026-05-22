# Extending Remote with Local

Sometimes the arrow points the other way: you want to **annotate** a remote entity you don't own with local-only data — bookmarks, tags, notes, ratings, approval status — and expose the pair as one cohesive entity.

## When to use this pattern

- A federated entity (Customers, Products, Flights, Suppliers) is your "master" reference data.
- You want to attach app-specific child records to it without touching the source system.
- Clients should see the remote master alongside its local children in one response.

This is the pattern SAP's [xtravels](https://github.com/capire/xtravels) and [risk-management](https://github.com/SAP-samples/cloud-cap-risk-management) samples use — remote reference entities, local child entities, stitched at query time.

## The CDS model

A federated projection declares a **local** association back to the child entity:

```cds title="db/schema.cds"
using { ProviderService as remote } from '../srv/external/ProviderService';

// Federated — live proxy to the remote Customers service.
// Declares a local backlink to Bookmarks (which lives in the local DB).
@federation.delegate
entity Customers as projection on remote.Customers {
    *,
    bookmarks : Association to many Bookmarks on bookmarks.customer = $self
};

// Local — stored in the app's own DB, FK points back to the federated Customer.
entity Bookmarks {
    key ID       : UUID;
        customer : Association to Customers;
        label    : String(100);
}
```

Two things worth noting:

- The `bookmarks` association is **added** to the wildcard projection. The remote `Customers` has no `bookmarks` field — this is a local-only extension.
- `Bookmarks.customer` is a managed association pointing back to the federated entity. CAP materializes a `customer_ID` FK column on the `Bookmarks` table.

## Flow 1: `$expand` from remote to local

=== "HTTP"

    ```http
    GET /consumer/Customers?$expand=bookmarks
    GET /consumer/Customers('C001')?$expand=bookmarks
    ```

=== "CQL"

    ```javascript
    SELECT.from(Customers).columns('*', c => c.bookmarks('*'));
    ```

The plugin:

1. Splits `req.query.SELECT.columns` — keeps the remote columns, strips the local `bookmarks` expand item.
2. Forwards the remote query to the provider: `GET /remote/Customers`.
3. Collects the keys from the remote response.
4. Queries the local table: `SELECT * FROM consumer_Bookmarks WHERE customer_ID IN (...)`.
5. Groups local rows by FK and stitches an array into each remote record's `bookmarks` slot.

Works for both lists and single records; there is no "expand only allowed for one record" limitation. `$filter`, `$orderby`, and `$top` inside the expand are supported with per-parent limiting — each customer gets its own top-N bookmarks.

```http
GET /consumer/Customers?$expand=bookmarks($filter=label eq 'VIP';$orderby=label;$top=3)
```

## Flow 2: Cross-service navigation: remote → local

See the canonical definition in [Cross-Service Scenarios](../concepts/cross-service-scenarios.md#cross-service-navigation-remote-local) (integration test `N2`).

Navigating from a remote key to its local children:

=== "HTTP"

    ```http
    GET /consumer/Customers('C001')/bookmarks
    GET /consumer/Customers('C001')/bookmarks?$filter=label eq 'VIP customer'
    GET /consumer/Customers('C001')/bookmarks?$select=label
    ```

=== "CQL"

    ```javascript
    SELECT.from(Customers, 'C001').columns(c => c.bookmarks('*'));
    ```

The plugin rewrites the navigation CQN: `Customers('C001').bookmarks` becomes `SELECT * FROM consumer_Bookmarks WHERE customer_ID = 'C001'`. No remote call is needed — the FK value is already in the URL. `$filter` and `$select` on the target work against the local table.

## Under the hood

This is the **cross-service expand: remote → local** flow described in [Cross-Service Scenarios](../concepts/cross-service-scenarios.md#cross-service-expand-remote-local) (integration tests `C1..C4`). The logic lives in [`buildLocalAssocInfo()`, `splitLocalExpands()`, and `resolveRemoteToLocalExpands()`](https://github.com/mikezaschka/cds-data-monorepo/blob/main/packages/cds-data-federation/srv/delegation/expand-remote-to-local.js). Cross-service navigation remote → local (`N2`) is rewritten by [`rewriteRemoteToLocalNavigation()`](https://github.com/mikezaschka/cds-data-monorepo/blob/main/packages/cds-data-federation/srv/delegation/cross-service-navigation.js).

## Gotchas

- **The FK target type must match.** If the remote `Customers.ID` is `String(10)`, declare the local `Bookmarks.customer` association accordingly so CAP materializes the correct `customer_ID` column type.
- **Lambda filters on local children work** — `$filter=bookmarks/any(b:b.label eq 'VIP')` is resolved by [`resolveLocalLambdaFilters()`](https://github.com/mikezaschka/cds-data-monorepo/blob/main/packages/cds-data-federation/srv/delegation/lambda-filters.js) which pre-queries the local DB and rewrites to a key IN on the remote query.
- **Creating a local child is a normal CAP insert** — `POST /consumer/Bookmarks` with `{ "customer_ID": "C001", "label": "VIP" }`. No federation involved; the FK is just a string that happens to match a remote key. No referential integrity is enforced across the boundary (the remote system has no knowledge of your Bookmarks table).
- **Deleting a remote Customer does not cascade** to local Bookmarks. The plugin does not propagate deletes across the service boundary. If the remote row disappears you will have orphan bookmarks until a reconciliation job cleans them up.

## See also

- [Joining Local with Remote](joining-local-with-remote.md) — the opposite direction (local entity with a federated target).
- [Cross-Provider Mashup](cross-provider-mashup.md) — stitching across two remote providers.
- [Cross-Service Scenarios](../concepts/cross-service-scenarios.md) — the canonical concept page.
- SAP's [risk-management sample](https://github.com/SAP-samples/cloud-cap-risk-management/blob/ext-service-s4hc-suppliers-ui/srv/risk-service.js) — the manual-handler equivalent of this pattern (~100 lines replaced by a single annotation).
