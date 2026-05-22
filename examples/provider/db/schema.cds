namespace studio;

entity Movies {
    key ID          : String(10);
        title       : String(200);
        year        : Integer;
        runtime     : Integer;
        avgRating   : Decimal(3, 1);
        voteCount   : Integer;
        posterUrl   : String(500);
        synopsis    : String(2000);
        releaseDate : Date;
        language    : String(10);
        country     : String(3);
        modifiedAt  : Timestamp;
        genre       : Association to Genres;
        director    : Association to Directors;
        castings    : Association to many Castings
                          on castings.movie = $self;
}

entity Genres {
    key ID          : String(10);
        name        : String(50);
        description : String(500);
}

entity Directors {
    key ID          : String(10);
        name        : String(100);
        birthYear   : Integer;
        nationality : String(50);
        bio         : String(2000);
}

entity Actors {
    key ID          : String(10);
        name        : String(100);
        birthYear   : Integer;
        nationality : String(50);
        bio         : String(2000);
}

entity Castings {
    key movie        : Association to Movies;
    key actor        : Association to Actors;
        role         : String(100);
        billingOrder : Integer;
}

