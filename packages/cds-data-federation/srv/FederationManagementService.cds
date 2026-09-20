/**
 * Federation management API — ADR 0017.
 *
 * One row per `@federation.*` entity, addressed by the consumption view's fully
 * qualified name, so a caller never needs to know what the underlying pipeline
 * or cache is called.
 *
 * Everything here is computed from the compiled model at request time.
 * No run statistics and no cache metrics are stored: those belong to
 * `cds-data-pipeline` and `cds-caching`, and this service points at them
 * instead of copying them.
 */
/**
 * Requires an authenticated user by default: this describes which remote
 * systems the app talks to, which entities it projects and how it renames and
 * scopes them, which is not public information. Override for a stricter role:
 *
 *     annotate FederationManagementService with @requires: 'FederationAdmin';
 */
@requires: 'authenticated-user'
service FederationManagementService @(path: '/federation') {

    @readonly
    @cds.persistence.skip: true
    entity FederatedEntities {

            /** Fully qualified consumption view — the stable address. */
        key entity                    : String(255);

            /** Last segment of `entity`, for display. */
            name                      : String(120);

            /** The CAP service exposing this view. */
            service                   : String(255);

            /** `replicate` or `delegate`. */
            strategy                  : String(20);

            /** `response`, `entity`, or null when the delegate is uncached. */
            cacheStrategy             : String(20);

            /** The remote service and entity this view projects on. */
            sourceService             : String(255);
            sourceEntity              : String(255);

            /** False when no write flag is set, which the scanner enforces with @readonly. */
            writable                  : Boolean;

            /** Comma-separated subset of `create,update,delete`; empty when read-only. */
            writeVerbs                : String(60);

            /** True when the projection is `{ * }` and no column restriction applies. */
            wildcardProjection        : Boolean;

            /** Whether the view carries a static `where`, applied on every request. */
            scoped                    : Boolean;

            /** Remote column names actually fetched. Empty for a wildcard projection. */
            projectedColumns          : array of String;

            /** Renames declared with `as` in the projection. */
            renames                   : array of {
                local  : String(120);
                remote : String(120);
            };

            /**
             * The pipeline backing this entity — `replicate`, or a delegate with
             * `cache.strategy: 'entity'`. Null for everything else. A name, not a
             * copy of its state: read it from the pipeline API.
             */
            pipeline                  : String(255);

            /** The cds-caching tag every response-cache entry of this entity carries. */
            cacheTag                  : String(160);

            /**
             * Where to look for this entity's runtime detail, or null when that
             * surface is not enabled. `pipelineDetailUnavailable` says why.
             */
            pipelineDetail            : String(512);
            pipelineDetailUnavailable : String(255);

            /** Same, for the response cache's metrics. */
            cacheDetail               : String(512);
            cacheDetailUnavailable    : String(255);

    } actions {

        /**
         * Re-read this entity's rows from the remote and upsert them locally.
         * Replicate only. Without `keys` the whole pipeline runs; with `keys`
         * it is a single-row event run (ADR 0013).
         */
        action refreshReplica(keys : String) returns FederationActionResult;

        /** Refill the entity-cache snapshot. Requires `cache.strategy: 'entity'`. */
        action refreshEntityCache()          returns FederationActionResult;

        /**
         * Drop this entity's response-cache entries by its automatic tag.
         * Requires `cache.strategy: 'response'`.
         */
        action invalidate()                  returns FederationActionResult;
    }

    type FederationActionResult {
        /** The entity acted on, echoed back. */
        entity  : String(255);
        /** What ran — `execute`, `executeEvent`, `refreshEntityCache`, `deleteByTag`. */
        action  : String(40);
        /** Free-text outcome, for an operator rather than a machine. */
        message : String(512);
    }
}
