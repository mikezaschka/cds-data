namespace streaming;

entity Regions {
    key code : String(10);
        name : String(50);
        continent : String(20);
}

entity StreamingManifests {
    key ID              : String(20);
        movie_ID        : String(10);
        region          : Association to Regions;
        bitrate         : Integer;
        drmScheme       : String(20);
        maxResolution   : String(10);
        availableFrom   : Date;
        availableUntil  : Date;
        manifestUrl     : String(500);
}
