namespace plugin.data_pipeline;

using { cuid } from '@sap/cds/common';

// ─── Types ─────────────────────────────────────────────────────────────────────

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
    external;
    event;
}

// ─── Aspects ───────────────────────────────────────────────────────────────────

/**
 * Extends a consumer target entity with a `source` primary-key column that
 * records the origin backend a row was replicated from (per ADR 0008).
 *
 * Consumers mix this aspect in when one target entity consolidates rows from
 * multiple source backends, and set `source.origin` on each sibling pipeline
 * to stamp the origin label into the `source` key column:
 *
 *     using { plugin.data_pipeline.sourced } from 'cds-data-pipeline/db';
 *
 *     entity BusinessPartners : bp.A_BusinessPartner, sourced {
 *         to_Addresses : Association to many BusinessPartnerAddresses
 *             on  to_Addresses.BusinessPartner = $self.BusinessPartner
 *             and to_Addresses.source          = $self.source;
 *     }
 *
 * The association-`source` extension is the easy-to-forget part, which is
 * the main reason the aspect ships from the plugin rather than being
 * reinvented in consumer code.
 */
aspect sourced {
    key source : String(100);
}

// ─── Entities ──────────────────────────────────────────────────────────────────

/**
 * Tracks the state and configuration of each pipeline.
 */
@cds.persistence.table
entity Pipelines {
    key name         : String;
        description  : String(1024); // optional human-readable label for management UI
        source         : LargeString; // JSON serialized source config
        target         : LargeString; // JSON serialized target config
        mode           : ReplicationMode;
        origin         : String(100); // ADR 0008: label stamped into target.source for multi-source fan-in
        lastSync       : Timestamp;
        lastKey        : String;
        status         : RunStatus default 'idle';
        errorCount     : Integer default 0;
        lastError      : String;
        statistics     : {
            created : Integer default 0;
            updated : Integer default 0;
            deleted : Integer default 0;
        };
        runs           : Composition of many PipelineRuns on runs.pipeline = $self;
}

/**
 * Records each pipeline run with timing, trigger, and statistics.
 */
@cds.persistence.table
entity PipelineRuns : cuid {
    pipeline   : Association to one Pipelines;
    status     : RunStatus;
    startTime  : Timestamp;
    endTime    : Timestamp;
    trigger    : RunTrigger;
    mode       : ReplicationMode;
    origin     : String(100); // ADR 0008: run-scoped echo of Pipelines.origin for observability
    error      : LargeString;
    statistics : {
        created : Integer default 0;
        updated : Integer default 0;
        deleted : Integer default 0;
    };
}
