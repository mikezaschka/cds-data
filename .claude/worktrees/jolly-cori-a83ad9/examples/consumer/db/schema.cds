using { plugin.data_federation as federation } from 'cds-data-federation';
using { ProviderService as studio } from '../srv/external/ProviderService';
using { LicensingService as licensing } from '../srv/external/LicensingService';
using { StreamingService as streaming } from '../srv/external/StreamingService';

namespace consumer;

// ─── Local entities ──────────────────────────────────────────────────────────

// User reviews — local, with a cross-service association to the delegated
// Movies entity. Drives Scenario B ($expand=movie on Reviews) and Scenario C
// (Movies(...)/reviews backlink).
entity Reviews {
    key ID        : UUID;
        movie     : Association to Movies;
        rating    : Integer;
        comment   : String(500);
        author    : String(100);
        createdAt : Timestamp;
}

// User bookmarks — local, with a cross-service association to Movies. Used
// for Scenario C: Movies(...)/bookmarks.
entity Bookmarks {
    key ID        : UUID;
        movie     : Association to Movies;
        label     : String(100);
        note      : String(500);
        createdAt : Timestamp;
}

// User watchlists — local; each row is a single movie the user wants to see.
// Primary Scenario B showcase: list-report of Watchlists with `$expand=movie`.
entity Watchlists {
    key ID        : UUID;
        user      : String(100);
        movie     : Association to Movies;
        label     : String(100);
        createdAt : Timestamp;
}

// Collections (e.g. "Nolan Films", "Sci-Fi Essentials") grouping multiple
// movies in a user-defined order. `items` is a local to-many; each item
// carries the FK to the remote catalog via `movie`.
entity MovieCollections {
    key ID    : UUID;
        name  : String(100);
        owner : String(100);
        items : Composition of many MovieCollectionItems
                    on items.collection = $self;
}

entity MovieCollectionItems {
    key ID         : UUID;
        collection : Association to MovieCollections;
        movie      : Association to Movies;
        position   : Integer;
}

// ─── Delegate (studio V4) ────────────────────────────────────────────────────

// Wildcard + read-only. Backlinks `reviews`/`bookmarks` drive Scenario C
// (remote → local expand) on the Movies Object Page.
@federation.delegate
entity Movies as projection on studio.Movies {
    *,
    reviews   : Association to many Reviews   on reviews.movie   = $self,
    bookmarks : Association to many Bookmarks on bookmarks.movie = $self
};

// Wildcard + read-only reference data.
@federation.delegate
entity Genres as projection on studio.Genres;

// Selective-writable: editors can update reference bios but not add/remove
// directors from the studio canon.
@federation.delegate: { update: true }
entity Directors as projection on studio.Directors;

// Fully writable: editorial admin can manage the actor roster end-to-end.
@federation.delegate: { writable: true }
entity Actors as projection on studio.Actors;

// ─── Delegate showcases (studio V4 with projection tricks) ───────────────────

// Field renames. A light "rebranded" view of Movies where the external PK `ID`
// becomes `filmId`, `title` becomes `filmTitle`, etc. Same underlying data.
@federation.delegate
entity Films as projection on studio.Movies {
    ID        as filmId,
    title     as filmTitle,
    year      as releaseYear,
    runtime,
    avgRating as rating,
    voteCount as votes,
    posterUrl,
    synopsis
};

// Static `where` on a projection — the plugin extracts this and injects it
// into every remote query, so the list is always pre-filtered to acclaimed
// films regardless of what the client sends in `$filter`.
@federation.delegate
entity AwardWinningMovies as projection on studio.Movies where avgRating >= 8.5;

// `excluding` — the plugin adds an explicit `$select` that omits these fields
// from remote requests. Bandwidth saver for grid views that don't need blobs.
@federation.delegate
entity MoviesLight as projection on studio.Movies excluding { synopsis, posterUrl };

// ─── Cached delegate ─────────────────────────────────────────────────────────

// Response cache via cds-caching. Trending is conceptually expensive to
// compute (imagine it aggregates watch stats), so we cache 60 seconds. Open
// the tile twice in a row and watch the second call come back instantly.
@federation.delegate: { cache: { ttl: 60000 } }
entity TrendingMovies as projection on studio.Movies {
    ID,
    title,
    year,
    avgRating,
    voteCount,
    posterUrl,
    genre
};

// ─── Delegate (licensing V2 — entity + field rename) ─────────────────────────

// Legacy licensing system exposed as OData V2; calls movies "titles". We
// project it into the local namespace with local-friendly names.
@federation.delegate
entity LicensedMovies as projection on licensing.Titles {
    ID           as licenseId,
    titleName    as movieTitle,
    movieRef     as movieId,
    licensor,
    territory,
    licenseStart,
    licenseEnd,
    exclusive
};

// ─── Delegate (streaming V4 — second provider) ───────────────────────────────

@federation.delegate
entity Regions as projection on streaming.Regions;

@federation.delegate
entity StreamingManifests as projection on streaming.StreamingManifests;

// ─── Replicate (studio V4 → local SQL) ───────────────────────────────────────

// A fully replicated copy of the movie catalog so local SQL queries can join
// it against reviews, bookmarks, and box-office without cross-service roundtrips.
// Excluding associations that point back into the remote service (can't persist).
@federation.replicate
entity ReplicatedMovies as projection on studio.Movies excluding { castings, genre, director };

// ─── Replicate (REST — box office time series) ───────────────────────────────

// REST-sourced time-series data. Offset pagination, `modifiedSince` as delta
// param, and the box-office server wraps records in `{ results: [...] }`.
@federation.replicate: {
    source: 'BoxOfficeRest',
    delta: { field: 'modifiedAt' },
    rest: {
        path: '/api/box-office',
        pagination: { type: 'offset', pageSize: 50 },
        deltaParam: 'modifiedSince',
        dataPath: 'results'
    }
}
entity ReplicatedBoxOffice {
    key ID         : String(40);
        movie_ID   : String(10);
        date       : Date;
        revenue    : Integer;
        tickets    : Integer;
        territory  : String(10);
        modifiedAt : Timestamp;
};
