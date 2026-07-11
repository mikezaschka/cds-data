import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const pipelineGuideConcepts = [
  { text: 'Overview', link: '/pipeline/guide/concepts/' },
  { text: 'Terminology', link: '/pipeline/guide/concepts/terminology' },
  { text: 'Inference rules', link: '/pipeline/guide/concepts/inference' },
  { text: 'Configuration overrides', link: '/pipeline/guide/concepts/overrides' },
  { text: 'Consumption views', link: '/pipeline/guide/concepts/consumption-views' },
  {
    text: 'Change history and pipeline replication',
    link: '/pipeline/guide/concepts/change-tracking-and-pipeline',
  },
]

const pipelineGuideSources = [
  { text: 'Overview', link: '/pipeline/guide/sources/' },
  { text: 'OData V2 / V4', link: '/pipeline/guide/sources/odata' },
  { text: 'REST', link: '/pipeline/guide/sources/rest' },
  { text: 'CQN', link: '/pipeline/guide/sources/cqn' },
  { text: 'Custom source adapter', link: '/pipeline/guide/sources/custom' },
]

const pipelineGuideTargets = [
  { text: 'Overview', link: '/pipeline/guide/targets/' },
  { text: 'Local DB', link: '/pipeline/guide/targets/db' },
  { text: 'OData', link: '/pipeline/guide/targets/odata' },
  { text: 'Custom target adapter', link: '/pipeline/guide/targets/custom' },
]

const pipelineGuideRecipes = [
  { text: 'Overview', link: '/pipeline/guide/recipes/' },
  { text: 'Built-in replicate', link: '/pipeline/guide/recipes/built-in-replicate' },
  { text: 'Built-in materialize', link: '/pipeline/guide/recipes/built-in-materialize' },
  { text: 'Multi-source fan-in', link: '/pipeline/guide/recipes/multi-source' },
  { text: 'Custom source adapter', link: '/pipeline/guide/recipes/custom-source-adapter' },
  { text: 'Custom target adapter', link: '/pipeline/guide/recipes/custom-target-adapter' },
  { text: 'Event hooks', link: '/pipeline/guide/recipes/event-hooks' },
  { text: 'Event-driven runs', link: '/pipeline/guide/recipes/event-driven-runs' },
  { text: 'External scheduling (JSS)', link: '/pipeline/guide/recipes/external-scheduling-jss' },
  { text: 'Internal scheduling (queued)', link: '/pipeline/guide/recipes/internal-scheduling-queued' },
]

const federationGettingStarted = [
  { text: 'Overview', link: '/federation/getting-started/' },
  { text: 'Installation', link: '/federation/getting-started/installation' },
  { text: 'First delegation', link: '/federation/getting-started/first-delegation' },
  { text: 'First replication', link: '/federation/getting-started/first-replication' },
  { text: 'First cache', link: '/federation/getting-started/first-cache' },
  { text: 'Joining local with remote', link: '/federation/getting-started/joining-local-with-remote' },
  { text: 'Extending remote with local', link: '/federation/getting-started/extending-remote-with-local' },
  { text: 'Cross-provider mashup', link: '/federation/getting-started/cross-provider-mashup' },
  { text: 'Mixing delegate and replicate', link: '/federation/getting-started/mixing-delegate-and-replicate' },
  {
    text: 'Local analytics over replicated',
    link: '/federation/getting-started/local-analytics-over-replicated',
  },
]

const federationConcepts = [
  { text: 'Overview', link: '/federation/concepts/' },
  { text: 'Terminology', link: '/federation/concepts/terminology' },
  { text: 'Consumption views', link: '/federation/concepts/consumption-views' },
  { text: 'Cross-service scenarios', link: '/federation/concepts/cross-service-scenarios' },
  { text: 'Service query execution', link: '/federation/concepts/service-query-execution' },
]

const materializationGettingStarted = [
  { text: 'Overview', link: '/materialization/getting-started/' },
  { text: 'Installation', link: '/materialization/getting-started/installation' },
  { text: 'First snapshot', link: '/materialization/getting-started/first-snapshot' },
]

const materializationConcepts = [
  { text: 'Stage then aggregate', link: '/materialization/concepts/stage-then-aggregate' },
]

export default withMermaid(
  defineConfig({
    title: 'cds-data CAP plugins',
    description:
      'Documentation for cds-data-federation, cds-data-materialization, and cds-data-pipeline — composable SAP CAP plugins.',
    base: '/cds-data/',
    lastUpdated: true,
    ignoreDeadLinks: [
      /^https?:\/\//,
    ],
    mermaid: {},
    markdown: {
      lineNumbers: true,
      languageAlias: { cds: 'typescript' },
      languageLabel: { cds: 'CDS' },
    },
    themeConfig: {
      search: { provider: 'local' },
      editLink: {
        pattern: 'https://github.com/mikezaschka/cds-data/edit/main/docs/:path',
        text: 'Edit this page on GitHub',
      },
      socialLinks: [
        { icon: 'github', link: 'https://github.com/mikezaschka/cds-data' },
      ],
      nav: [
        { text: 'Home', link: '/' },
        { text: 'Concepts', link: '/concepts/', activeMatch: '^/concepts/' },
        { text: 'cds-data-federation', link: '/federation/', activeMatch: '^/federation/' },
        { text: 'cds-data-materialization', link: '/materialization/', activeMatch: '^/materialization/' },
        { text: 'cds-data-pipeline', link: '/pipeline/', activeMatch: '^/pipeline/' },
      ],
      sidebar: {
        '/concepts/': [
          {
            text: 'Shared concepts',
            collapsed: false,
            items: [
              { text: 'The cds-data suite', link: '/concepts/' },
              { text: 'Terminology', link: '/concepts/terminology' },
              { text: 'Architecture', link: '/concepts/architecture' },
              { text: 'CDS 10, HCQL and MCP', link: '/concepts/cds-10' },
            ],
          },
          {
            text: 'Per-plugin docs',
            collapsed: false,
            items: [
              { text: 'cds-data-federation', link: '/federation/' },
              { text: 'cds-data-pipeline', link: '/pipeline/' },
              { text: 'cds-data-materialization', link: '/materialization/' },
            ],
          },
        ],
        '/pipeline/': [
          { text: 'Home', link: '/pipeline/' },
          {
            text: 'Guide',
            collapsed: false,
            items: [
              { text: 'Introduction', link: '/pipeline/guide/introduction' },
              { text: 'Get started', link: '/pipeline/guide/get-started' },
              { text: 'Feature activation', link: '/pipeline/guide/feature-activation' },
              { text: 'Pipeline Console', link: '/pipeline/guide/pipeline-console' },
              { text: 'Concepts', collapsed: true, items: pipelineGuideConcepts },
              { text: 'Sources', collapsed: true, items: pipelineGuideSources },
              { text: 'Targets', collapsed: true, items: pipelineGuideTargets },
              { text: 'Recipes', collapsed: true, items: pipelineGuideRecipes },
            ],
          },
          {
            text: 'Reference',
            collapsed: true,
            items: [
              { text: 'Features', link: '/pipeline/reference/features' },
              { text: 'Programmatic API', link: '/pipeline/reference/api' },
              { text: 'Management service', link: '/pipeline/reference/management-service' },
            ],
          },
        ],
        '/federation/': [
          { text: 'Home', link: '/federation/' },
          {
            text: 'Getting started',
            collapsed: false,
            items: federationGettingStarted,
          },
          {
            text: 'Concepts',
            collapsed: true,
            items: federationConcepts,
          },
          {
            text: 'Reference',
            collapsed: true,
            items: [
              { text: 'Features', link: '/federation/reference/features' },
              { text: 'Choosing a strategy', link: '/federation/reference/choosing-a-strategy' },
              { text: 'Annotations', link: '/federation/reference/annotations' },
              { text: 'Comparison with CAP', link: '/federation/reference/comparison' },
            ],
          },
          {
            text: 'Integration',
            collapsed: true,
            items: [
              { text: 'cds-caching', link: '/federation/integration/caching' },
              { text: 'MCP (AI agents)', link: '/federation/integration/mcp' },
              { text: 'Multi-Tenancy', link: '/federation/integration/multitenancy' },
            ],
          },
        ],
        '/materialization/': [
          { text: 'Home', link: '/materialization/' },
          {
            text: 'Getting started',
            collapsed: false,
            items: materializationGettingStarted,
          },
          {
            text: 'Concepts',
            collapsed: true,
            items: materializationConcepts,
          },
          {
            text: 'Reference',
            collapsed: true,
            items: [
              { text: 'Features', link: '/materialization/reference/features' },
              { text: 'Annotations', link: '/materialization/reference/annotations' },
            ],
          },
        ],
      },
      footer: {
        message: 'Released under the MIT License.',
        copyright: 'Copyright © Mike Zaschka',
      },
    },
  }),
)
