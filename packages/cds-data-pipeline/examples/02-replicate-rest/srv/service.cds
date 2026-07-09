using { example02 } from '../db/schema';

service ExampleService @(path: '/odata/v4/example') {
    entity ExchangeRates as projection on example02.ExchangeRates;
}
