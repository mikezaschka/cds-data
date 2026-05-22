using { streaming } from '../db/schema';

service StreamingService {
    @readonly entity Regions            as projection on streaming.Regions;
    @readonly entity StreamingManifests as projection on streaming.StreamingManifests;
}
