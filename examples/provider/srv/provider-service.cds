using { studio }    from '../db/schema';
using { licensing } from '../db/licensing-schema';

service ProviderService {
    entity Movies    as projection on studio.Movies;
    entity Genres    as projection on studio.Genres;
    entity Directors as projection on studio.Directors;
    entity Actors    as projection on studio.Actors;
    entity Castings  as projection on studio.Castings;
}

service LicensingService {
    entity Titles            as projection on licensing.Titles;
    entity TerritoryLicenses as projection on licensing.TerritoryLicenses;
}
