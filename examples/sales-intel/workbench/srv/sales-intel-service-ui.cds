using SalesIntelService from './sales-intel-service';

// ─── CustomerNotes (local, List Report — My Work) ────────────────────────────
// A sales rep's own notes. Shows a local entity whose rows are authored here
// but whose associated `customer` is resolved via cross-service expand:
// local → remote against Northwind.
annotate SalesIntelService.CustomerNotes with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Customer Note',
            TypeNamePlural : 'Customer Notes',
            Title          : { Value: note },
            Description    : { Value: author }
        },
        LineItem: [
            { Value: customer.companyName, Label: 'Customer' },
            { Value: customer.country,     Label: 'Country' },
            { Value: note,                 Label: 'Note' },
            { Value: author,               Label: 'Author' },
            { Value: createdAt,            Label: 'Written' }
        ],
        SelectionFields: [ author ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: 'Overview', Target: '@UI.FieldGroup#Overview' }
        ],
        FieldGroup #Overview: {
            Data: [
                { Value: customer_customerId, Label: 'Customer ID' },
                { Value: customer.companyName },
                { Value: note },
                { Value: author },
                { Value: createdAt }
            ]
        }
    }
);

// ─── Customers (delegate, rich Object Page — Master Data + Customer 360) ─────
// One app, two launchpad tiles: "Customers" (browse master data) and
// "Customer 360" (open an Object Page to see local notes + risk + tasks
// stitched in via cross-service expand: remote → local).
annotate SalesIntelService.Customers with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Customer',
            TypeNamePlural : 'Customers',
            Title          : { Value: companyName },
            Description    : { Value: contactName }
        },
        LineItem: [
            { Value: customerId,   Label: 'ID' },
            { Value: companyName,  Label: 'Company' },
            { Value: contactName,  Label: 'Contact' },
            { Value: contactTitle, Label: 'Title' },
            { Value: city,         Label: 'City' },
            { Value: country,      Label: 'Country' },
            { Value: phone,        Label: 'Phone' }
        ],
        SelectionFields: [ companyName, city, country ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: 'Overview', Target: '@UI.FieldGroup#Overview' },
            { $Type: 'UI.ReferenceFacet', Label: 'Notes',    Target: 'notes/@UI.LineItem' },
            { $Type: 'UI.ReferenceFacet', Label: 'Tasks',    Target: 'tasks/@UI.LineItem' }
        ],
        FieldGroup #Overview: {
            Data: [
                { Value: customerId },
                { Value: companyName },
                { Value: contactName },
                { Value: contactTitle },
                { Value: city },
                { Value: country },
                { Value: phone }
            ]
        }
    }
);

// Notes / Tasks facet tables need their own LineItem annotation — in the
// object page the facet renders whatever LineItem the associated entity
// carries. CustomerNotes already has one above; add a compact one for
// FollowUpTasks here so the facet renders cleanly.
annotate SalesIntelService.FollowUpTasks with @(
    UI: {
        LineItem: [
            { Value: dueOn, Label: 'Due' },
            { Value: title, Label: 'Task' },
            { Value: done,  Label: 'Done' }
        ]
    }
);

// ─── SalesOrders (replicate, Analytical List Page — Intelligence) ────────────
// The teaching moment for "why replicate?". The ALP needs `$apply/groupby`,
// which CAP rejects for delegate entities. Because SalesOrders is replicated
// into local SQLite, the same query works.
//
// The ALP template resolves DEFAULT annotations (no qualifier) for
// `@UI.Chart`, `@UI.PresentationVariant`, `@UI.LineItem`, `@UI.SelectionFields`.
// Using qualifiers here breaks the template with "ALP flavor needs both
// chart and table to load the application".
//
// Chart measure mechanics — why this is not just `Measures: [freight]`.
// CAP silently drops `@Aggregation.default: #SUM` from the emitted metadata,
// so property-level aggregation hints never reach the FE template. Without a
// resolvable aggregation method the MDC chart's `items` array stays empty and
// the chart never finishes binding (stuck `aria-busy="true"`). The supported
// pattern is a named `@Analytics.AggregatedProperty` referenced via
// `DynamicMeasures` — see the SAP Fiori Elements "Chart Qualifier" docs.
annotate SalesIntelService.SalesOrders with @(
    Analytics.AggregatedProperty #totalFreight: {
        $Type               : 'Analytics.AggregatedPropertyType',
        Name                : 'totalFreight',
        AggregationMethod   : 'sum',
        AggregatableProperty: 'freight',
        ![@Common.Label]    : 'Total Freight'
    },
    UI: {
        HeaderInfo: {
            TypeName       : 'Sales Order',
            TypeNamePlural : 'Sales Orders',
            Title          : { Value: orderId },
            Description    : { Value: shipCountry }
        },
        Chart: {
            $Type              : 'UI.ChartDefinitionType',
            ChartType          : #Column,
            Title              : 'Freight by Country',
            Dimensions         : [ shipCountry ],
            DynamicMeasures    : [ '@Analytics.AggregatedProperty#totalFreight' ],
            DimensionAttributes: [{
                $Type     : 'UI.ChartDimensionAttributeType',
                Dimension : shipCountry,
                Role      : #Category
            }],
            MeasureAttributes  : [{
                $Type          : 'UI.ChartMeasureAttributeType',
                DynamicMeasure : '@Analytics.AggregatedProperty#totalFreight',
                Role           : #Axis1
            }]
        },
        // Sort by the aggregatable base property. The FE template rewrites
        // this to the `_fe_aggregatable_freight` sorter at runtime. Using a
        // non-aggregatable property (e.g. orderDate) here leaves the MDC
        // chart stuck in `aria-busy` because the framework tries to map the
        // sorter onto the aggregated result set.
        PresentationVariant: {
            Visualizations: [
                '@UI.Chart',
                '@UI.LineItem'
            ],
            SortOrder: [
                { $Type: 'Common.SortOrderType', Property: freight, Descending: true }
            ]
        },
        LineItem: [
            { Value: orderId,     Label: 'Order ID' },
            { Value: customerId,  Label: 'Customer' },
            { Value: orderDate,   Label: 'Order Date' },
            { Value: shippedDate, Label: 'Shipped' },
            { Value: shipCountry, Label: 'Country' },
            { Value: freight,     Label: 'Freight' }
        ],
        SelectionFields: [ shipCountry, customerId ]
    }
) {
    shipCountry @Analytics.Dimension;
    freight     @Analytics.Measure;
};

annotate SalesIntelService.SalesOrders with @(
    Aggregation.ApplySupported: {
        $Type                   : 'Aggregation.ApplySupportedType',
        Transformations         : [ 'aggregate', 'groupby', 'filter', 'orderby', 'top', 'skip', 'concat', 'identity' ],
        GroupableProperties     : [ shipCountry, customerId, employeeId ],
        AggregatableProperties  : [
            { $Type: 'Aggregation.AggregatablePropertyType', Property: freight }
        ]
    }
);
