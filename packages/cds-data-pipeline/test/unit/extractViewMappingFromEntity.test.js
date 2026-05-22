const { extractViewMappingFromEntityDef } = require('../../srv/lib/extractViewMappingFromEntity')

describe('extractViewMappingFromEntityDef', () => {
    const { expect } = require('@jest/globals')

    it('returns null for plain entity definitions', () => {
        expect(
            extractViewMappingFromEntityDef({
                kind: 'entity',
                elements: { ID: { type: 'cds.String' } },
            })
        ).toBeNull()
    })

    it('extracts renames and projected columns from projection.columns', () => {
        const inferred = extractViewMappingFromEntityDef({
            kind: 'entity',
            projection: {
                columns: [
                    { ref: ['BusinessPartner'], as: 'ID' },
                    { ref: ['PersonFullName'], as: 'Name' },
                    { ref: ['LastChangeDate'] },
                ],
                where: ['=', { ref: ['blocked'] }, false],
            },
        })
        expect(inferred.isWildcard).toBe(false)
        expect(inferred.projectedColumns).toEqual(['BusinessPartner', 'PersonFullName', 'LastChangeDate'])
        expect(inferred.remoteToLocal).toEqual({
            BusinessPartner: 'ID',
            PersonFullName: 'Name',
        })
        expect(inferred.localToRemote).toEqual({
            ID: 'BusinessPartner',
            Name: 'PersonFullName',
        })
        expect(inferred.staticWhere).toEqual(['=', { ref: ['blocked'] }, false])
    })

    it('treats wildcard column as isWildcard', () => {
        const inferred = extractViewMappingFromEntityDef({
            projection: {
                columns: ['*'],
            },
        })
        expect(inferred.isWildcard).toBe(true)
        expect(inferred.projectedColumns).toEqual([])
    })

    it('treats empty columns with excluding as wildcard with excludedColumns', () => {
        const inferred = extractViewMappingFromEntityDef({
            projection: {
                columns: [],
                excluding: ['stock', 'modifiedAt'],
            },
        })
        expect(inferred.isWildcard).toBe(true)
        expect(inferred.excludedColumns).toEqual(['stock', 'modifiedAt'])
    })

    it('reads projection from query.SELECT when projection key is absent', () => {
        const inferred = extractViewMappingFromEntityDef({
            query: {
                SELECT: {
                    from: { ref: ['S', 'Remote'] },
                    columns: [{ ref: ['a'], as: 'b' }],
                },
            },
        })
        expect(inferred.isWildcard).toBe(false)
        expect(inferred.projectedColumns).toEqual(['a'])
        expect(inferred.remoteToLocal).toEqual({ a: 'b' })
    })
})
