namespace plugin.data_materialization;

using { User } from '@sap/cds/common';

/**
 * Optional tracking fields for materialized snapshot targets.
 */
aspect materialized {
    lastMaterializedAt : Timestamp @cds.on.insert: $now;
    lastMaterializedBy : User      @cds.on.insert: $user;
}
