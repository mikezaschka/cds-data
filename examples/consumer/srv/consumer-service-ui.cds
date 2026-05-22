using ConsumerService from './consumer-service';

// ─── Movies (delegate, read-only) ────────────────────────────────────────────
annotate ConsumerService.Movies with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Movie',
            TypeNamePlural : 'Movies',
            Title          : { Value: title },
            Description    : { Value: synopsis },
            ImageUrl       : posterUrl
        },
        LineItem: [
            { Value: posterUrl, Label: 'Poster' },
            { Value: ID,         Label: 'ID' },
            { Value: title,      Label: 'Title' },
            { Value: year,       Label: 'Year' },
            { Value: avgRating,  Label: 'Rating' },
            { Value: voteCount,  Label: 'Votes' },
            { Value: runtime,    Label: 'Runtime (min)' }
        ],
        SelectionFields: [ title, year, avgRating ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: 'Overview',  Target: '@UI.FieldGroup#Overview' },
            { $Type: 'UI.ReferenceFacet', Label: 'Reviews',   Target: 'reviews/@UI.LineItem' },
            { $Type: 'UI.ReferenceFacet', Label: 'Bookmarks', Target: 'bookmarks/@UI.LineItem' }
        ],
        FieldGroup #Overview: {
            Data: [
                { Value: ID },
                { Value: title },
                { Value: synopsis },
                { Value: year },
                { Value: releaseDate },
                { Value: runtime },
                { Value: avgRating },
                { Value: voteCount },
                { Value: language },
                { Value: country }
            ]
        }
    }
) {
    posterUrl @UI.IsImageURL;
};

// ─── TrendingMovies (cached delegate) ────────────────────────────────────────
annotate ConsumerService.TrendingMovies with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Trending Movie',
            TypeNamePlural : 'Trending Movies',
            Title          : { Value: title },
            ImageUrl       : posterUrl
        },
        LineItem: [
            { Value: posterUrl, Label: 'Poster' },
            { Value: title,     Label: 'Title' },
            { Value: year,      Label: 'Year' },
            { Value: avgRating, Label: 'Rating' },
            { Value: voteCount, Label: 'Votes' }
        ],
        SelectionFields: [ title, avgRating ]
    }
) {
    posterUrl @UI.IsImageURL;
};

// ─── AwardWinningMovies (static where) ───────────────────────────────────────
annotate ConsumerService.AwardWinningMovies with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Award-Winning Movie',
            TypeNamePlural : 'Award-Winning Movies',
            Title          : { Value: title },
            Description    : { Value: synopsis },
            ImageUrl       : posterUrl
        },
        LineItem: [
            { Value: posterUrl, Label: 'Poster' },
            { Value: title,     Label: 'Title' },
            { Value: year,      Label: 'Year' },
            { Value: avgRating, Label: 'Rating' },
            { Value: voteCount, Label: 'Votes' }
        ],
        SelectionFields: [ title, year ]
    }
) {
    posterUrl @UI.IsImageURL;
};

// ─── Films (field renames) ───────────────────────────────────────────────────
annotate ConsumerService.Films with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Film',
            TypeNamePlural : 'Films',
            Title          : { Value: filmTitle },
            ImageUrl       : posterUrl
        },
        LineItem: [
            { Value: posterUrl,   Label: 'Poster' },
            { Value: filmId,      Label: 'Film ID' },
            { Value: filmTitle,   Label: 'Title' },
            { Value: releaseYear, Label: 'Year' },
            { Value: rating,      Label: 'Rating' },
            { Value: votes,       Label: 'Votes' },
            { Value: runtime,     Label: 'Runtime (min)' }
        ],
        SelectionFields: [ filmTitle, releaseYear, rating ]
    }
) {
    posterUrl @UI.IsImageURL;
};

// ─── Actors (delegate, writable) ─────────────────────────────────────────────
annotate ConsumerService.Actors with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Actor',
            TypeNamePlural : 'Actors',
            Title          : { Value: name },
            Description    : { Value: bio }
        },
        LineItem: [
            { Value: ID,          Label: 'ID' },
            { Value: name,        Label: 'Name' },
            { Value: birthYear,   Label: 'Born' },
            { Value: nationality, Label: 'Nationality' }
        ],
        SelectionFields: [ name, nationality ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: 'Profile', Target: '@UI.FieldGroup#Profile' }
        ],
        FieldGroup #Profile: {
            Data: [
                { Value: ID },
                { Value: name },
                { Value: birthYear },
                { Value: nationality },
                { Value: bio }
            ]
        }
    }
);

// ─── Directors (delegate, selective-writable update) ─────────────────────────
annotate ConsumerService.Directors with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Director',
            TypeNamePlural : 'Directors',
            Title          : { Value: name },
            Description    : { Value: bio }
        },
        LineItem: [
            { Value: ID,          Label: 'ID' },
            { Value: name,        Label: 'Name' },
            { Value: birthYear,   Label: 'Born' },
            { Value: nationality, Label: 'Nationality' }
        ],
        SelectionFields: [ name, nationality ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: 'Profile', Target: '@UI.FieldGroup#Profile' }
        ],
        FieldGroup #Profile: {
            Data: [
                { Value: ID },
                { Value: name },
                { Value: birthYear },
                { Value: nationality },
                { Value: bio }
            ]
        }
    }
);

// ─── LicensedMovies (V2 + rename) ────────────────────────────────────────────
annotate ConsumerService.LicensedMovies with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Licensed Movie',
            TypeNamePlural : 'Licensed Movies',
            Title          : { Value: movieTitle },
            Description    : { Value: licensor }
        },
        LineItem: [
            { Value: licenseId,    Label: 'License ID' },
            { Value: movieId,      Label: 'Movie ID' },
            { Value: movieTitle,   Label: 'Title' },
            { Value: licensor,     Label: 'Licensor' },
            { Value: territory,    Label: 'Territory' },
            { Value: licenseStart, Label: 'From' },
            { Value: licenseEnd,   Label: 'Until' },
            { Value: exclusive,    Label: 'Exclusive' }
        ],
        SelectionFields: [ licensor, territory, exclusive ]
    }
);

// ─── StreamingManifests (second provider) ────────────────────────────────────
annotate ConsumerService.StreamingManifests with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Streaming Manifest',
            TypeNamePlural : 'Streaming Manifests',
            Title          : { Value: ID }
        },
        LineItem: [
            { Value: ID,             Label: 'Manifest ID' },
            { Value: movie_ID,       Label: 'Movie ID' },
            { Value: region_code,    Label: 'Region' },
            { Value: bitrate,        Label: 'Bitrate (kbps)' },
            { Value: maxResolution,  Label: 'Resolution' },
            { Value: drmScheme,      Label: 'DRM' },
            { Value: availableFrom,  Label: 'Available from' },
            { Value: availableUntil, Label: 'Available until' }
        ],
        SelectionFields: [ region_code, drmScheme ]
    }
);

// ─── Watchlists (local, $expand=movie drives cross-service expand: local → remote) ─
annotate ConsumerService.Watchlists with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Watchlist Entry',
            TypeNamePlural : 'Watchlist',
            Title          : { Value: label },
            Description    : { Value: user }
        },
        LineItem: [
            { Value: label,       Label: 'Label' },
            { Value: user,        Label: 'User' },
            { Value: movie.title, Label: 'Movie' },
            { Value: movie.year,  Label: 'Year' },
            { Value: createdAt,   Label: 'Added' }
        ],
        SelectionFields: [ user, label ]
    }
);

// ─── Reviews (local, $expand=movie drives cross-service expand: local → remote) ─
annotate ConsumerService.Reviews with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Review',
            TypeNamePlural : 'Reviews',
            Title          : { Value: movie.title },
            Description    : { Value: author }
        },
        LineItem: [
            { Value: author,      Label: 'Author' },
            { Value: movie.title, Label: 'Movie' },
            { Value: rating,      Label: 'Rating' },
            { Value: comment,     Label: 'Comment' },
            { Value: createdAt,   Label: 'Written' }
        ],
        SelectionFields: [ author, rating ]
    }
);

// ─── ReplicatedBoxOffice (REST-replicated) ───────────────────────────────────
annotate ConsumerService.ReplicatedBoxOffice with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Box Office Record',
            TypeNamePlural : 'Box Office',
            Title          : { Value: ID }
        },
        LineItem: [
            { Value: movie_ID,  Label: 'Movie' },
            { Value: date,      Label: 'Date' },
            { Value: territory, Label: 'Territory' },
            { Value: revenue,   Label: 'Revenue' },
            { Value: tickets,   Label: 'Tickets' }
        ],
        SelectionFields: [ movie_ID, territory ]
    }
);

// ─── ReplicatedMovies ────────────────────────────────────────────────────────
annotate ConsumerService.ReplicatedMovies with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Replicated Movie',
            TypeNamePlural : 'Replicated Movies',
            Title          : { Value: title }
        },
        LineItem: [
            { Value: ID,         Label: 'ID' },
            { Value: title,      Label: 'Title' },
            { Value: year,       Label: 'Year' },
            { Value: avgRating,  Label: 'Rating' },
            { Value: language,   Label: 'Language' }
        ],
        SelectionFields: [ title, year ]
    }
);
