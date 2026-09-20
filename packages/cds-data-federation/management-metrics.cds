// Exposes delegate metrics on the management API. Loaded only when the
// management API *and* metrics are both switched on, since it needs both models.
using { FederationManagementService } from './srv/FederationManagementService';
using { plugin.data_federation.DelegateMetrics as StoredDelegateMetrics } from './db/metrics';

extend service FederationManagementService with {
    /**
     * Raw per-bucket counters. `avgLatency` is derived here rather than stored:
     * averages do not merge, so the table keeps a sum (ADR 0019 §4).
     */
    @readonly
    entity DelegateMetrics as projection on StoredDelegateMetrics {
        *,
        case when requests > 0 then latencySumMs / requests else null end as avgLatency : Double
    };
}
