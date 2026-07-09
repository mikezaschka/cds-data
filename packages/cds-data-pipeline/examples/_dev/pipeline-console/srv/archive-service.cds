using { archiveDev } from '../db/archive-schema';

@readonly
service ArchiveDevService @(path: '/odata/v4/archive', impl: './archive-service.js') {
    entity ShipmentArchive as projection on archiveDev.ShipmentArchive;
}
