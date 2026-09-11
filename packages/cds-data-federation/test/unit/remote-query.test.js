const cds = require('@sap/cds')
const { applyExpandedSemantics, evaluateWhere } = require('../../srv/delegation/cqn-evaluator')
const { localFieldName, remoteFieldName } = require('../../srv/delegation/expand-columns')
const { buildDirectRemoteColumns, hiddenEvaluationFields } = require('../../srv/delegation/remote-query')

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
            buyer_ID: 'customer_ID',
            item: 'product',
            item_ID: 'product_ID',
        },
        remoteToLocal: {
            ID: 'orderId',
            customer: 'buyer',
            customer_ID: 'buyer_ID',
            product: 'item',
            product_ID: 'item_ID',
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
            orderBy: [
                {
                    func: 'tolower',
                    args: [{ ref: ['productName'] }],
                    sort: 'asc',
                },
                {
                    xpr: [{ ref: ['unitPrice'] }],
                    sort: 'desc',
                },
            ],
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
        expect(item.orderBy).toEqual([
            {
                func: 'tolower',
                args: [{ ref: ['name'] }],
                sort: 'asc',
            },
            {
                xpr: [{ ref: ['price'] }],
                sort: 'desc',
            },
        ])
        expect(expand.where[0].ref).toEqual(['unitPrice'])
        expect(expand.orderBy[0].args[0].ref).toEqual(['productName'])
        expect(expand.orderBy[1].xpr[0].ref).toEqual(['unitPrice'])
    })

    it('applies the expand target static where alongside the client filter', () => {
        const staticWhere = [{ ref: ['category'] }, '=', { val: 'Electronics' }]
        const scopedRegistry = {
            ...registry,
            'App.Products': { ...productMapping, staticWhere },
        }
        const expand = {
            ref: ['item'],
            expand: [{ ref: ['productName'] }],
            // A top-level `or` must not widen the target view's permanent scope.
            where: [{ ref: ['unitPrice'] }, '>', { val: 100 }, 'or', { ref: ['unitPrice'] }, '<', { val: 10 }],
        }
        const columns = buildDirectRemoteColumns(
            { columns: ['*', expand] },
            topMapping,
            remoteOrders,
            'App.ShippedOrders',
            scopedRegistry,
        )

        const item = columns.find(col => col.ref?.[0] === 'product' && col.expand)
        expect(item.where).toEqual([
            { xpr: [{ ref: ['price'] }, '>', { val: 100 }, 'or', { ref: ['price'] }, '<', { val: 10 }] },
            'and',
            { xpr: staticWhere },
        ])
        expect(scopedRegistry['App.Products'].staticWhere).toEqual(staticWhere)
    })

    it('applies the expand target static where when the client sends no filter', () => {
        const scopedRegistry = {
            ...registry,
            'App.Products': {
                ...productMapping,
                staticWhere: [{ ref: ['category'] }, '=', { val: 'Electronics' }],
            },
        }
        const columns = buildDirectRemoteColumns(
            { columns: ['*', { ref: ['item'], expand: [{ ref: ['productName'] }] }] },
            topMapping,
            remoteOrders,
            'App.ShippedOrders',
            scopedRegistry,
        )

        const item = columns.find(col => col.ref?.[0] === 'product' && col.expand)
        expect(item.where).toEqual([{ ref: ['category'] }, '=', { val: 'Electronics' }])
    })

    it('skips nested expand where/orderBy on OData V2 direct queries', () => {
        const scopedRegistry = {
            ...registry,
            'App.Products': {
                ...productMapping,
                staticWhere: [{ ref: ['category'] }, '=', { val: 'Electronics' }],
            },
        }
        const columns = buildDirectRemoteColumns(
            {
                columns: [
                    '*',
                    {
                        ref: ['item'],
                        expand: [{ ref: ['productName'] }],
                        where: [{ ref: ['unitPrice'] }, '>', { val: 100 }],
                        orderBy: [{ ref: ['productName'], sort: 'asc' }],
                        limit: { rows: { val: 1 }, offset: { val: 1 } },
                    },
                ],
            },
            topMapping,
            remoteOrders,
            'App.ShippedOrders',
            scopedRegistry,
            { isODataV2: true },
        )

        const item = columns.find(col => col.ref?.[0] === 'product' && col.expand)
        expect(item).not.toHaveProperty('where')
        expect(item).not.toHaveProperty('orderBy')
        expect(item).not.toHaveProperty('limit')
    })

    it('evaluates the CDS predicate operators used by V2 static scopes', () => {
        const row = { category: 'Electronics', price: '29.99', stock: null }
        const entity = { elements: { price: { type: 'cds.Decimal' } } }

        expect(evaluateWhere([
            { ref: ['category'] }, 'in', { list: [{ val: 'Electronics' }, { val: 'Hardware' }] },
            'and',
            { ref: ['price'] }, 'between', { val: 20 }, 'and', { val: 40 },
            'and',
            { ref: ['category'] }, 'like', { val: 'Ele%' },
            'and',
            { ref: ['stock'] }, 'is', { val: null },
        ], row, entity)).toBe(true)
        expect(evaluateWhere([
            'not', { ref: ['category'] }, '=', { val: 'Furniture' },
        ], row, entity)).toBe(true)
        expect(evaluateWhere([
            { ref: ['price'] }, '=', { val: 29.99 },
        ], row, entity)).toBe(true)
    })

    it('fully consumes mixed boolean expressions instead of short-circuiting the parser', () => {
        const where = [
            { ref: ['category'] }, '=', { val: 'Furniture' },
            'and',
            { ref: ['price'] }, '>', { val: 100 },
            'or',
            { ref: ['category'] }, '=', { val: 'Electronics' },
        ]

        expect(evaluateWhere(where, { category: 'Electronics', price: '29.99' })).toBe(true)
    })

    it('fails closed when a V2 scope uses an unsupported predicate', () => {
        expect(() => evaluateWhere([
            { ref: ['category'] }, 'matches', { val: '.*' },
        ], { category: 'Furniture' })).toThrow(/Unsupported CQN predicate operator/)
    })

    it('applies translated client filters and ordering to V2 expanded collections', () => {
        const rows = [
            { name: 'Mouse', price: '29.99' },
            { name: 'Hub', price: '79.99' },
            { name: 'Laptop', price: '1299.99' },
        ]
        const entity = { elements: { price: { type: 'cds.Decimal' } } }

        expect(applyExpandedSemantics(
            rows,
            [{ ref: ['price'] }, '<', { val: 100 }],
            [{ ref: ['name'], sort: 'desc' }],
        )).toEqual([
            { name: 'Mouse', price: '29.99' },
            { name: 'Hub', price: '79.99' },
        ])
        expect(applyExpandedSemantics(
            rows,
            null,
            [{ ref: ['price'], sort: 'desc' }],
            null,
            entity,
        ).map(row => row.name)).toEqual(['Laptop', 'Hub', 'Mouse'])
        expect(applyExpandedSemantics(
            rows,
            null,
            [{ ref: ['price'], sort: 'asc' }],
            { rows: { val: 1 }, offset: { val: 1 } },
            entity,
        ).map(row => row.name)).toEqual(['Hub'])
    })

    it('compares IEEE-754-compatible Int64 and Decimal strings without losing precision', () => {
        const entity = {
            elements: {
                sequence: { type: 'cds.Integer64' },
                amount: { type: 'cds.Decimal' },
            },
        }
        const lower = '9007199254740992'
        const higher = '9007199254740993'

        expect(evaluateWhere(
            [{ ref: ['sequence'] }, '=', { val: higher }],
            { sequence: lower },
            entity,
        )).toBe(false)
        expect(applyExpandedSemantics(
            [{ sequence: higher }, { sequence: lower }],
            null,
            [{ ref: ['sequence'], sort: 'asc' }],
            null,
            entity,
        ).map(row => row.sequence)).toEqual([lower, higher])
        expect(evaluateWhere(
            [{ ref: ['amount'] }, '=', { val: 0.1 }],
            { amount: '0.10' },
            entity,
        )).toBe(true)
    })

    it('does not match null operands in ordered comparisons', () => {
        const entity = { elements: { stock: { type: 'cds.Integer' } } }
        for (const operator of ['<', '<=', '>', '>=']) {
            expect(evaluateWhere(
                [{ ref: ['stock'] }, operator, { val: 100 }],
                { stock: null },
                entity,
            )).toBe(false)
            expect(evaluateWhere(
                [{ ref: ['stock'] }, operator, { val: null }],
                { stock: 50 },
                entity,
            )).toBe(false)
        }
    })

    it('preserves OData null semantics in string functions', () => {
        const row = { value: null }

        for (const func of ['contains', 'startswith', 'endswith']) {
            expect(evaluateWhere([
                { func, args: [{ ref: ['value'] }, { val: '' }] },
            ], row)).toBe(false)
        }
        for (const func of ['tolower', 'toupper', 'trim']) {
            expect(evaluateWhere([
                { func, args: [{ ref: ['value'] }] }, '=', { val: '' },
            ], row)).toBe(false)
        }
        expect(evaluateWhere([
            { func: 'length', args: [{ ref: ['value'] }] }, '=', { val: 0 },
        ], row)).toBe(false)
        expect(evaluateWhere([
            { func: 'concat', args: [{ ref: ['value'] }, { val: 'suffix' }] }, '=', { val: 'suffix' },
        ], row)).toBe(true)
    })

    it('preserves unknown predicates through NOT and boolean operators', () => {
        const row = { stock: null, name: null }

        expect(evaluateWhere([
            'not', { xpr: [{ ref: ['stock'] }, '<', { val: 100 }] },
        ], row)).toBe(false)
        expect(evaluateWhere([
            'not', { func: 'contains', args: [{ ref: ['name'] }, { val: 'x' }] },
        ], row)).toBe(false)
        expect(evaluateWhere([
            { ref: ['stock'] }, 'not', 'between', { val: 1 }, 'and', { val: 100 },
        ], row)).toBe(false)
        expect(evaluateWhere([
            { ref: ['stock'] }, 'not', 'in', { list: [{ val: 1 }, { val: 2 }] },
        ], row)).toBe(false)
        expect(evaluateWhere([
            { xpr: [{ ref: ['stock'] }, '<', { val: 100 }] },
            'or',
            { val: true },
        ], row)).toBe(true)
        expect(evaluateWhere([
            'not',
            {
                xpr: [
                    { xpr: [{ ref: ['stock'] }, '<', { val: 100 }] },
                    'or',
                    { val: false },
                ],
            },
        ], row)).toBe(false)
        expect(evaluateWhere([
            'not',
            {
                xpr: [
                    { xpr: [{ ref: ['stock'] }, '<', { val: 100 }] },
                    'and',
                    { val: true },
                ],
            },
        ], row)).toBe(false)
    })

    it('hides V2 evaluation fields excluded from or unrelated to the projection', () => {
        expect(hiddenEvaluationFields(
            {
                isWildcard: true,
                excludedColumns: ['stock'],
                projectedColumns: [],
                remoteToLocal: {},
            },
            [{ ref: ['stock'] }, '>', { val: 0 }],
            null,
            null,
        )).toEqual(['stock'])

        expect(hiddenEvaluationFields(
            {
                isWildcard: false,
                projectedColumns: ['name'],
                remoteToLocal: { name: 'productName' },
            },
            [{ ref: ['name_suffix'] }, '=', { val: 'x' }],
            null,
            null,
        )).toEqual(['name_suffix'])
    })

    it('handles scaled Decimal zero without producing an empty coefficient', () => {
        const entity = { elements: { amount: { type: 'cds.Decimal' } } }
        expect(evaluateWhere(
            [{ ref: ['amount'] }, '=', { val: 0 }],
            { amount: '0.00' },
            entity,
        )).toBe(true)
    })

    it('translates only exact association foreign-key mappings', () => {
        const localToRemote = {
            productName: 'name',
            buyer: 'customer',
            buyer_ID: 'customer_ID',
        }
        const remoteToLocal = {
            name: 'productName',
            customer: 'buyer',
            customer_ID: 'buyer_ID',
        }

        expect(remoteFieldName('buyer_ID', localToRemote)).toBe('customer_ID')
        expect(localFieldName('customer_ID', remoteToLocal)).toBe('buyer_ID')
        expect(remoteFieldName('productName_suffix', localToRemote)).toBe('productName_suffix')
        expect(localFieldName('name_suffix', remoteToLocal)).toBe('name_suffix')
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
