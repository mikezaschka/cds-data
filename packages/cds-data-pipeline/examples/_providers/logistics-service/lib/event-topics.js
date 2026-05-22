/**
 * CAP messaging topics for LogisticsService test events.
 * Used by the provider emit actions and by example 07's messaging bridge.
 * Must match @topic on events in srv/logistics-service.cds.
 */
const TOPIC_PREFIX = 'logistics.LogisticsService'

exports.SHIPMENT_KEY_TEST = `${TOPIC_PREFIX}.ShipmentKeyTest`
exports.SHIPMENT_PAYLOAD_TEST = `${TOPIC_PREFIX}.ShipmentPayloadTest`
