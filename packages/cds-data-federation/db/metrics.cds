namespace plugin.data_federation;

/**
 * Per-entity counters for the delegate path — ADR 0019.
 *
 * Loaded only when `requires.data-federation.metrics.enabled` is true, so an
 * app that never switches metrics on deploys no table.
 *
 * Stores what *merges*: additive counters plus a latency sum, with min and max
 * maintained by compare-and-set. There is deliberately no average column —
 * averages cannot be combined across flushes or across app instances without
 * their counts, so the average is derived on read as `latencySumMs / requests`.
 */
@cds.persistence.table
entity DelegateMetrics {
        /** `hourly:2026-09-20T14` — the bucket convention cds-caching uses. */
    key bucket       : String(32);
        /** Consumption-view FQN: the address, per ADR 0018. */
    key entity       : String(255);
        requests     : Integer default 0;
        errors       : Integer default 0;
        writes       : Integer default 0;
        writeErrors  : Integer default 0;
        /** Summed remote round-trip time. Divide by `requests` for the average. */
        latencySumMs : Double default 0;
        minLatency   : Double;
        maxLatency   : Double;
}
