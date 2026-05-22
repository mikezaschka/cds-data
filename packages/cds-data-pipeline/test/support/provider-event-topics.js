/**
 * Must match FQNs of events in test/fixtures/provider/srv/provider-service.cds
 * (namespace test.provider, service ProviderService).
 */
const NS = 'test.provider'
const SVC = 'ProviderService'
exports.CUSTOMER_KEY_TEST = `${NS}.${SVC}.CustomerKeyTest`
exports.CUSTOMER_PAYLOAD_TEST = `${NS}.${SVC}.CustomerPayloadTest`
