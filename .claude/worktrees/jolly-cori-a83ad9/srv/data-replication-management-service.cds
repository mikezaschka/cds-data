using { plugin.data_federation as federation } from '../index.cds';

service DataFederationService @(path: '/federation') {

    @readonly
    entity Federations as projection on federation.Federations;

    @readonly
    entity ReplicationRuns as projection on federation.ReplicationRuns;

    action run(name : String, mode : String) returns String;
    action flush(name : String) returns String;
    function status(name : String) returns Federations;
}
