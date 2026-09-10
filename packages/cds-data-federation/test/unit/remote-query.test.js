const cds = require('@sap/cds')
const { buildDirectRemoteColumns } = require('../../srv/delegation/remote-query')

describe('Direct remote query columns', () => {
    const remoteOrders = {
        elements: {
            ID: {},
            customer: { target: 'Remote.Customers', keys: [{ ref: ['ID'] }] },
            product: { target: 'Remote.Products', keys: [{ ref: ['ID'] }] },
            status: {},
        },
    }
    const remoteProducts = {
        elements: {
            ID: {},
            name: {},
            price: {},
            stock: {},
            modifiedAt: {},
        },
    }
    const remoteCustomers = {
        elements: {
            ID: {},
            name: {},
            email: {},
        },
    }
    const topMapping = {
        isWildcard: false,
        projectedColumns: [
            { ref: ['ID'], as: 'orderId' },
            { ref: ['customer'], as: 'buyer' },
            { ref: ['product'], as: 'item' },
            'status',
        ],
        localToRemote: {
            orderId: 'ID',
            buyer: 'customer',
            item: 'product',
        },
        remoteToLocal: {
            ID: 'orderId',
            customer: 'buyer',
            product: 'item',
        },
    }
    const productMapping = {
        isWildcard: false,
        projectedColumns: [
            { ref: ['ID'], as: 'productId' },
            { ref: ['name'], as: 'productName' },
            { ref: ['price'], as: 'unitPrice' },
        ],
        localToRemote: {
            productId: 'ID',
            productName: 'name',
            unitPrice: 'price',
        },
        remoteToLocal: {
            ID: 'productId',
            name: 'productName',
            price: 'unitPrice',
        },
    }
    const customerMapping = {
        isWildcard: true,
        projectedColumns: [],
        localToRemote: {},
        remoteToLocal: {},
    }
    const definitions = {
        'App.ShippedOrders': {
            elements: {
                orderId: {},
                buyer: { target: 'App.Customers' },
                item: { target: 'App.Products' },
                status: {},
            },
        },
        'App.Products': { elements: {} },
        'App.Customers': { elements: {} },
        'Remote.Orders': remoteOrders,
        'Remote.Products': remoteProducts,
        'Remote.Customers': remoteCustomers,
    }
    const registry = {
        'App.Products': productMapping,
        'App.Customers': customerMapping,
    }
    let previousModel

    beforeEach(() => {
        previousModel = cds.model
        cds.model = { definitions }
    })

    afterEach(() => {
        cds.model = previousModel
    })

    it('separates scalar columns from renamed expands and narrows inner wildcards', () => {
        const columns = buildDirectRemoteColumns(
            {
                columns: [
                    '*',
                    { ref: ['buyer'], expand: ['*'] },
                    { ref: ['item'], expand: ['*'] },
                ],
            },
            topMapping,
            remoteOrders,
            'App.ShippedOrders',
            registry,
        )

        expect(columns.some(col => col.ref?.[0] === 'customer' && !col.expand)).toBe(false)
        expect(columns.some(col => col.ref?.[0] === 'product' && !col.expand)).toBe(false)
        expect(columns.some(col => col.ref?.[0] === 'customer_ID')).toBe(true)
        expect(columns.some(col => col.ref?.[0] === 'product_ID')).toBe(true)

        const buyer = columns.find(col => col.ref?.[0] === 'customer' && col.expand)
        expect(buyer.expand).toEqual([
            { ref: ['ID'] },
            { ref: ['name'] },
            { ref: ['email'] },
        ])

        const item = columns.find(col => col.ref?.[0] === 'product' && col.expand)
        expect(item.expand).toEqual([
            { ref: ['ID'] },
            { ref: ['name'] },
            { ref: ['price'] },
        ])
        expect(item.expand.some(col => col === '*' || col?.['*'])).toBe(false)
    })

    it('translates explicit inner selects, filters, and ordering without mutating input', () => {
        const mapping = {
            ...topMapping,
            projectedColumns: [
                ...topMapping.projectedColumns,
                { ref: ['customer', 'name'], as: 'buyerName' },
            ],
        }
        const expand = {
            ref: ['item'],
            expand: [{ ref: ['productName'] }],
            where: [
                { ref: ['unitPrice'] },
                '>',
                { val: 100 },
                'and',
                {
                    func: 'contains',
                    args: [{ ref: ['productName'] }, { val: 'Pro' }],
                },
            ],
            orderBy: [{ ref: ['productName'], sort: 'asc' }],
        }
        const columns = buildDirectRemoteColumns(
            {
                columns: [
                    '*',
                    expand,
                ],
            },
            mapping,
            remoteOrders,
            'App.ShippedOrders',
            registry,
        )

        expect(columns.some(col => col.ref?.join('.') === 'customer.name')).toBe(true)
        const item = columns.find(col => col.ref?.[0] === 'product' && col.expand)
        expect(item.expand).toEqual([{ ref: ['name'] }])
        expect(item.where).toEqual([
            { ref: ['price'] },
            '>',
            { val: 100 },
            'and',
            {
                func: 'contains',
                args: [{ ref: ['name'] }, { val: 'Pro' }],
            },
        ])
        expect(item.orderBy).toEqual([{ ref: ['name'], sort: 'asc' }])
        expect(expand.where[0].ref).toEqual(['unitPrice'])
        expect(expand.orderBy[0].ref).toEqual(['productName'])
    })

    it('replaces projected associations with their remote foreign keys', () => {
        const columns = buildDirectRemoteColumns(
            {},
            topMapping,
            remoteOrders,
            'App.ShippedOrders',
            registry,
        )

        expect(columns).toEqual([
            { ref: ['ID'] },
            { ref: ['customer_ID'] },
            { ref: ['product_ID'] },
            { ref: ['status'] },
        ])
    })

    it('translates renamed association foreign keys in an explicit select', () => {
        const columns = buildDirectRemoteColumns(
            { columns: [{ ref: ['orderId'] }, { ref: ['buyer_ID'] }, { ref: ['item_ID'] }] },
            topMapping,
            remoteOrders,
            'App.ShippedOrders',
            registry,
        )

        expect(columns).toEqual([
            { ref: ['ID'] },
            { ref: ['customer_ID'] },
            { ref: ['product_ID'] },
        ])
    })
})
