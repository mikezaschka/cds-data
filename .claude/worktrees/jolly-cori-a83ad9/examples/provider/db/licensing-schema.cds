namespace licensing;

entity Titles {
    key ID           : String(10);
        titleName    : String(200);
        movieRef     : String(10);
        licensor     : String(50);
        territory    : String(3);
        licenseStart : Date;
        licenseEnd   : Date;
        exclusive    : Boolean default false;
}

entity TerritoryLicenses {
    key title     : Association to Titles;
    key territory : String(3);
        rights    : String(50);
}
