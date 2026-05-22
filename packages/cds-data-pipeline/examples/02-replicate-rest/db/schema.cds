namespace example02;

// The REST source has no CSN / CDS model — the plugin can't infer the
// target shape from a `projection on <remote>`. We declare the target
// table locally and point the pipeline at the endpoint via `rest.path`.
// `@cds.persistence.table` is implicit for plain entities; kept explicit
// for readability.
@cds.persistence.table
entity ExchangeRates {
    key ID            : String(30);
        baseCurrency  : String(3);
        quoteCurrency : String(3);
        rate          : Decimal(10, 4);
        rateDate      : Date;
        modifiedAt    : Timestamp;
}
