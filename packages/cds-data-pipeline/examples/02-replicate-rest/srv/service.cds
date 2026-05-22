using { example02 } from '../db/schema';
using from 'cds-data-pipeline/srv/monitor-annotations';

service ExampleService @(path: '/odata/v4/example') {
    entity ExchangeRates as projection on example02.ExchangeRates;
}
