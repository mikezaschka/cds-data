using { consumer } from '../db/schema';

// The pipeline management OData service (/pipeline/) and the Pipeline Console
// (/pipeline-console/) are provided by cds-data-pipeline via
// `management.reuse` in package.json — no manual `using` import needed.

service ConsumerService {

    // ── Delegate (studio V4, :4444) ──────────────────────────────────────────
    @cds.redirection.target
    entity Movies    as projection on consumer.Movies;
    entity Genres    as projection on consumer.Genres;
    entity Directors as projection on consumer.Directors;
    entity Actors    as projection on consumer.Actors;

    // ── Delegate showcases ───────────────────────────────────────────────────
    entity Films              as projection on consumer.Films;
    entity AwardWinningMovies as projection on consumer.AwardWinningMovies;
    entity MoviesLight        as projection on consumer.MoviesLight;

    // ── Cached delegate (TTL 60s) ────────────────────────────────────────────
    entity TrendingMovies     as projection on consumer.TrendingMovies;

    // ── Delegate (licensing V2, :4444/odata/v2/licensing) — entity+field rename
    entity LicensedMovies     as projection on consumer.LicensedMovies;

    // ── Delegate (streaming V4, :4445) ───────────────────────────────────────
    entity Regions            as projection on consumer.Regions;
    entity StreamingManifests as projection on consumer.StreamingManifests;

    // ── Replicate (studio V4 → local SQL) ────────────────────────────────────
    @readonly
    entity ReplicatedMovies   as projection on consumer.ReplicatedMovies;

    // ── Replicate (REST → local SQL) ─────────────────────────────────────────
    @readonly
    entity ReplicatedBoxOffice as projection on consumer.ReplicatedBoxOffice;

    // ── Local entities with associations into delegated services ────────────
    entity Reviews              as projection on consumer.Reviews;
    entity Bookmarks            as projection on consumer.Bookmarks;
    entity Watchlists           as projection on consumer.Watchlists;
    entity MovieCollections     as projection on consumer.MovieCollections;
    entity MovieCollectionItems as projection on consumer.MovieCollectionItems;
}
