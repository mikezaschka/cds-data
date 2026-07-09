const {
    columnRefToRemotePath,
    columnRefToSelectArg,
    buildColumnMappingsFromProjection,
    projectedColumnToSelectArg,
    projectedColumnToRemoteSelectRef,
} = require('../../srv/lib/columnRefPath')

describe('columnRefPath', () => {
    it('maps single-segment columns to string select args', () => {
        expect(columnRefToSelectArg({ ref: ['modifiedAt'] })).toBe('modifiedAt')
        expect(columnRefToSelectArg({ ref: ['ID'], as: 'productId' })).toEqual({
            ref: ['ID'],
            as: 'productId',
        })
    })

    it('maps multi-segment path expressions to ref objects', () => {
        expect(columnRefToRemotePath({ ref: ['customer', 'name'], as: 'buyerName' })).toBe('customer.name')
        expect(columnRefToSelectArg({ ref: ['customer', 'name'], as: 'buyerName' })).toEqual({
            ref: ['customer', 'name'],
            as: 'buyerName',
        })
    })

    it('buildColumnMappingsFromProjection handles flatten associations', () => {
        const mapped = buildColumnMappingsFromProjection([
            { ref: ['ID'], as: 'orderId' },
            { ref: ['customer', 'name'], as: 'buyerName' },
            { ref: ['product', 'name'], as: 'itemName' },
            { ref: ['quantity'] },
        ])
        expect(mapped.projectedColumns).toEqual([
            { ref: ['ID'], as: 'orderId' },
            { ref: ['customer', 'name'], as: 'buyerName' },
            { ref: ['product', 'name'], as: 'itemName' },
            'quantity',
        ])
        expect(mapped.remoteToLocal).toMatchObject({
            ID: 'orderId',
            'customer.name': 'buyerName',
            buyerName: 'buyerName',
            'product.name': 'itemName',
            itemName: 'itemName',
        })
    })

    it('projectedColumnToSelectArg normalizes string and object columns for CQN', () => {
        expect(projectedColumnToSelectArg('price')).toEqual({ ref: ['price'] })
        expect(projectedColumnToSelectArg({ ref: ['price'], as: 'unitPrice' })).toEqual({
            ref: ['price'],
            as: 'unitPrice',
        })
    })

    it('projectedColumnToRemoteSelectRef strips aliases for remote batch fetch', () => {
        expect(projectedColumnToRemoteSelectRef({ ref: ['ID'], as: 'productId' })).toEqual({ ref: ['ID'] })
        expect(projectedColumnToRemoteSelectRef('category')).toEqual({ ref: ['category'] })
    })
})
