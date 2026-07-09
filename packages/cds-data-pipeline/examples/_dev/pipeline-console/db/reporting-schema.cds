namespace reportingDev;

@cds.persistence.skip
entity CarrierFacts {
    key code         : String(10);
        name         : String(100);
        serviceLevel : String(20);
        contactEmail : String(100);
}
