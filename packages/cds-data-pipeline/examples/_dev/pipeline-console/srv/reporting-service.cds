using { reportingDev } from '../db/reporting-schema';

service ReportingService @(path: '/reporting', impl: './reporting-service.js') {
  @readonly
  entity CarrierFacts as projection on reportingDev.CarrierFacts;
}
