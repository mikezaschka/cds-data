<script setup lang="ts">
const federation = {
  name: 'cds-data-federation',
  href: '/federation/',
  summary: 'Annotate consumption views to proxy remotes live or sync on a schedule.',
  strategies: [
    {
      label: '@federation.delegate',
      hint: 'Live proxy at request time',
      code: `@federation.delegate
entity Partners as projection on remote.A_BusinessPartner {
    BusinessPartner as ID,
    BusinessPartnerFullName as name
};`,
    },
    {
      label: '@federation.replicate',
      hint: 'Scheduled sync into local DB',
      code: `@federation.replicate: { schedule: 600000 }
entity ReplicatedPartners as projection on remote.A_BusinessPartner {
    BusinessPartner as ID,
    BusinessPartnerFullName as name
};`,
    },
  ],
} as const

type Plugin = {
  name: string
  href: string
  summary: string
  code: string
  badge?: string
}

const plugins: Plugin[] = [
  {
    name: 'cds-data-materialization',
    href: '/materialization/',
    badge: 'Experimental',
    summary: 'Persist scheduled rollups from group-by projections. Experimental — not yet released.',
    code: `@materialize.snapshot: { source: { service: 'db' } }
entity DailyRevenue as projection on Orders {
  key customerId,
      sum(amount) as totalAmount
}
group by customerId;`,
  },
  {
    name: 'cds-data-pipeline',
    href: '/pipeline/',
    summary: 'Register pipelines programmatically — tracker, retry, and management API.',
    code: `await pipelines.addPipeline({
  name: 'Products',
  source: { service: 'northwind', entity: 'Products' },
  target: { entity: 'my.app.LocalProducts' },
  schedule: 600_000,
});`,
  },
]
</script>

<template>
  <section class="packages" aria-label="Package overview">
    <article class="packages-card packages-card--wide">
      <h3 class="packages-title">
        <a :href="federation.href">{{ federation.name }}</a>
      </h3>
      <p class="packages-summary">{{ federation.summary }}</p>
      <div class="packages-strategies">
        <div
          v-for="strategy in federation.strategies"
          :key="strategy.label"
          class="packages-strategy"
        >
          <div class="packages-strategy-head">
            <span class="packages-strategy-label">{{ strategy.label }}</span>
            <span class="packages-strategy-hint">{{ strategy.hint }}</span>
          </div>
          <div class="packages-code">
            <pre><code>{{ strategy.code }}</code></pre>
          </div>
        </div>
      </div>
    </article>

    <div class="packages-row">
      <article v-for="pkg in plugins" :key="pkg.name" class="packages-card">
        <h3 class="packages-title">
          <a :href="pkg.href">{{ pkg.name }}</a>
          <span v-if="pkg.badge" class="packages-badge">{{ pkg.badge }}</span>
        </h3>
        <p class="packages-summary">{{ pkg.summary }}</p>
        <div class="packages-code">
          <pre><code>{{ pkg.code }}</code></pre>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.packages {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  max-width: 72rem;
  margin: 2.25rem auto 0;
}

.packages-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.25rem;
}

.packages-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  padding: 1.35rem 1.4rem 1.45rem;
  min-width: 0;
}

.packages-card--wide {
  padding-bottom: 1.5rem;
}

.packages-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  line-height: 1.35;
}

.packages-title a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.packages-title a:hover {
  text-decoration: underline;
}

.packages-badge {
  margin-left: 0.5rem;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 600;
  vertical-align: middle;
  color: var(--vp-c-warning-1, #b8860b);
  background: var(--vp-c-warning-soft, rgba(234, 179, 8, 0.14));
}

.packages-summary {
  margin: 0.5rem 0 1rem;
  font-size: 0.88rem;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}

.packages-strategies {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

.packages-strategy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.packages-strategy-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.65rem;
  margin-bottom: 0.55rem;
}

.packages-strategy-label {
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.packages-strategy-hint {
  font-size: 0.76rem;
  color: var(--vp-c-text-3);
}

.packages-row .packages-code {
  margin-top: auto;
}

.packages-code {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg);
  flex: 1;
}

.packages-code pre {
  margin: 0;
  padding: 1rem 1.1rem;
  overflow-x: auto;
  font-size: 0.78rem;
  line-height: 1.5;
  height: 100%;
}

.packages-code code {
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-1);
  white-space: pre;
}

@media (max-width: 960px) {
  .packages-strategies,
  .packages-row {
    grid-template-columns: 1fr;
  }
}
</style>
