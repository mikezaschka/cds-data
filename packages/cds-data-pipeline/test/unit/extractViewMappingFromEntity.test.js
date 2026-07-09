const { extractViewMappingFromEntityDef } = require('../../srv/lib/extractViewMappingFromEntity')

describe('extractViewMappingFromEntityDef', () => {
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
        expect(inferred.projectedColumns).toEqual([
            { ref: ['BusinessPartner'], as: 'ID' },
            { ref: ['PersonFullName'], as: 'Name' },
            'LastChangeDate',
        ])
        expect(inferred.remoteToLocal).toMatchObject({
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

    it('extracts flatten association paths in projected columns', () => {
        const inferred = extractViewMappingFromEntityDef({
            kind: 'entity',
            projection: {
                columns: [
                    { ref: ['ID'], as: 'orderId' },
                    { ref: ['customer', 'name'], as: 'buyerName' },
                    { ref: ['quantity'] },
                ],
            },
        })
        expect(inferred.projectedColumns).toEqual([
            { ref: ['ID'], as: 'orderId' },
            { ref: ['customer', 'name'], as: 'buyerName' },
            'quantity',
        ])
        expect(inferred.remoteToLocal['customer.name']).toBe('buyerName')
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
        expect(inferred.projectedColumns).toEqual([{ ref: ['a'], as: 'b' }])
        expect(inferred.remoteToLocal).toMatchObject({ a: 'b' })
    })
})
