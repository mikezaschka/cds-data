namespace plugin.data_federation;

using { User } from '@sap/cds/common';

// ─── Aspects ───────────────────────────────────────────────────────────────────

/**
 * Adds replication tracking fields to target entities.
 * Apply this aspect to entities that receive replicated data.
 *
 * Retained on the federation side (not the pipeline engine) because the
 * `replicated` flavor is a user-facing federation concept and surfaces in
 * consumer models that opt into `@federation.replicate`. See ADR 0005
 * §Consequences "Some aspects keep replicated flavor".
 */
aspect replicated {
    lastReplicatedAt : Timestamp @cds.on.insert: $now;
    lastReplicatedBy : User      @cds.on.insert: $user;
}
