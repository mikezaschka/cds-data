namespace plugin.data_federation;

using { cuid, User } from '@sap/cds/common';

// ─── Aspects ───────────────────────────────────────────────────────────────────

/**
 * Adds replication tracking fields to target entities.
 * Apply this aspect to entities that receive replicated data.
 */
aspect replicated {
    lastReplicatedAt : Timestamp @cds.on.insert: $now;
    lastReplicatedBy : User      @cds.on.insert: $user;
}

/**
 * Adds a source discriminator key to entities that receive data from
 * multiple remote sources (e.g., multiple S/4 systems).
 */
aspect multiSourced {
    key sourceService : String(100);
}

// ─── Types ─────────────────────────────────────────────────────────────────────

type FederationStrategy : String enum {
    delegate;
    replicate;
}

type ReplicationMode : String enum {
    delta;
    full;
}

type RunStatus : String enum {
    idle;
    running;
    failed;
}

type RunTrigger : String enum {
    manual;
    scheduled;
    event;
}

// ─── Entities ──────────────────────────────────────────────────────────────────

/**
 * Tracks the state and configuration of each federation/replication.
 */
@cds.persistence.table
entity Federations {
    key name       : String;
        strategy   : FederationStrategy;
        source     : LargeString; // JSON serialized source config
        target     : LargeString; // JSON serialized target config
        mode       : ReplicationMode;
        lastSync   : Timestamp;
        lastKey    : String;
        status     : RunStatus default 'idle';
        errorCount : Integer default 0;
        lastError  : String;
        statistics : {
            created : Integer default 0;
            updated : Integer default 0;
            deleted : Integer default 0;
        };
        runs       : Composition of many ReplicationRuns on runs.tracker = $self;
}

/**
 * Records each replication run with timing, trigger, and statistics.
 */
@cds.persistence.table
entity ReplicationRuns : cuid {
    tracker    : Association to one Federations;
    status     : RunStatus;
    startTime  : Timestamp;
    endTime    : Timestamp;
    trigger    : RunTrigger;
    mode       : ReplicationMode;
    error      : LargeString;
    statistics : {
        created : Integer default 0;
        updated : Integer default 0;
        deleted : Integer default 0;
    };
}
