---
hide:
  - navigation
---

# Concepts

The mental model behind `cds-data-federation`. Read these pages once; the rest of the reference makes sense against this foundation.

<div class="grid cards" markdown>

-   :material-book-alphabet: **Terminology**

    ---

    How *federation*, *delegation*, *replication*, and *consumption view* are used here versus in CAP's Service Integration guide and the data industry at large.

    [:octicons-arrow-right-24: Terminology](terminology.md)

-   :material-link-variant: **Consumption views**

    ---

    The CDS projection IS the federation contract. What every `as projection on remote.X { … }` declaration tells the plugin.

    [:octicons-arrow-right-24: Consumption Views](consumption-views.md)

-   :material-graph-outline: **Cross-service scenarios**

    ---

    The canonical reference for `$expand` and navigation that crosses a local / remote boundary — four expand topologies and two navigation flows.

    [:octicons-arrow-right-24: Cross-Service Scenarios](cross-service-scenarios.md)

-   :material-routes: **Service query execution**

    ---

    How CQL queries reach delegate handlers — and what happens when they don't. The dispatch pipeline from `cds.run()` and HTTP down to the DB service.

    [:octicons-arrow-right-24: Service Query Execution](service-query-execution.md)

</div>
