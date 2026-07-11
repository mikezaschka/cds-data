<script setup lang="ts">
const ariaLabel =
  'Architecture: CAP consumption views connect to cds-data-federation ' +
  '(@federation.delegate live proxy, @federation.replicate scheduled sync) and ' +
  'cds-data-materialization (@materialize.snapshot). Replicate and snapshot bind to ' +
  'cds-data-pipeline data-pipeline (READ, MAP, WRITE). Delegate reads remote ' +
  'services at request time; the pipeline reads remote services and writes the local database.'
</script>

<template>
  <figure class="arch" role="img" :aria-label="ariaLabel">
    <!-- Layer 1: application -->
    <div class="arch-layer">
      <div class="arch-card arch-card--app">
        <p class="arch-kicker">Your CAP application</p>
        <p class="arch-title">Consumption views</p>
        <p class="arch-desc">CDS projections with <code>@federation.*</code> or <code>@materialize.*</code> annotations</p>
      </div>
    </div>

    <div class="arch-bridge" aria-hidden="true">
      <span class="arch-bridge-line" />
      <span class="arch-bridge-label">annotation plugins</span>
      <span class="arch-bridge-line" />
    </div>

    <!-- Layer 2: plugins -->
    <div class="arch-layer arch-layer--split">
      <div class="arch-card">
        <p class="arch-kicker">cds-data-federation</p>
        <ul class="arch-flows">
          <li class="arch-flow">
            <div class="arch-flow-node">
              <span class="arch-flow-name">@federation.delegate</span>
              <span class="arch-flow-desc">live proxy</span>
            </div>
            <span class="arch-flow-arrow" aria-hidden="true">→</span>
            <span class="arch-flow-target">Remote services</span>
            <span class="arch-tag arch-tag--live">request time</span>
          </li>
          <li class="arch-flow">
            <div class="arch-flow-node">
              <span class="arch-flow-name">@federation.replicate</span>
              <span class="arch-flow-desc">scheduled entity sync</span>
            </div>
            <span class="arch-flow-arrow" aria-hidden="true">→</span>
            <span class="arch-flow-target">data-pipeline</span>
            <span class="arch-tag">pipeline-binding</span>
          </li>
        </ul>
      </div>

      <div class="arch-card">
        <p class="arch-kicker">cds-data-materialization</p>
        <ul class="arch-flows">
          <li class="arch-flow">
            <div class="arch-flow-node">
              <span class="arch-flow-name">@materialize.snapshot</span>
              <span class="arch-flow-desc">scheduled query-shape rollups</span>
            </div>
            <span class="arch-flow-arrow" aria-hidden="true">→</span>
            <span class="arch-flow-target">data-pipeline</span>
            <span class="arch-tag">pipeline-binding</span>
          </li>
        </ul>
      </div>
    </div>

    <div class="arch-bridge" aria-hidden="true">
      <span class="arch-bridge-line" />
      <span class="arch-bridge-label">cds-data-pipeline</span>
      <span class="arch-bridge-line" />
    </div>

    <!-- Layer 3: engine -->
    <div class="arch-layer">
      <div class="arch-card arch-card--engine">
        <p class="arch-kicker">cds-data-pipeline</p>
        <p class="arch-title">data-pipeline</p>
        <p class="arch-pipeline">
          <span class="arch-phase">READ</span>
          <span class="arch-phase-sep">→</span>
          <span class="arch-phase">MAP</span>
          <span class="arch-phase-sep">→</span>
          <span class="arch-phase">WRITE</span>
        </p>
        <p class="arch-desc arch-desc--mono">tracker · retry · /pipeline</p>
      </div>
    </div>

    <!-- Layer 4: data endpoints -->
    <div class="arch-layer arch-layer--split arch-layer--endpoints">
      <div class="arch-endpoint">
        <div>
          <p class="arch-endpoint-title">Remote services</p>
          <p class="arch-endpoint-desc">OData · REST · CQN</p>
        </div>
        <span class="arch-endpoint-role">source</span>
      </div>
      <div class="arch-endpoint">
        <div>
          <p class="arch-endpoint-title">Local database</p>
          <p class="arch-endpoint-desc">replicated rows &amp; snapshots</p>
        </div>
        <span class="arch-endpoint-role">target</span>
      </div>
    </div>
  </figure>
</template>

<style scoped>
.arch {
  --arch-radius: 12px;
  max-width: 46rem;
  margin: 1.75rem auto 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.arch-layer {
  display: flex;
  flex-direction: column;
}

.arch-layer--split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.arch-layer--endpoints {
  margin-top: 0.75rem;
  align-items: stretch;
}

.arch-card {
  border: 1px solid var(--vp-c-divider);
  border-radius: var(--arch-radius);
  background: var(--vp-c-bg-soft);
  padding: 1rem 1.15rem;
}

.arch-card--app {
  text-align: center;
  padding: 1.15rem 1.25rem 1.25rem;
}

.arch-card--engine {
  text-align: center;
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 40%, var(--vp-c-divider));
  background: color-mix(in srgb, var(--vp-c-brand-soft) 40%, var(--vp-c-bg-soft));
  box-shadow: 0 1px 2px color-mix(in srgb, var(--vp-c-brand-1) 8%, transparent);
}

.arch-kicker {
  margin: 0 0 0.5rem;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vp-c-text-2);
}

.arch-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  line-height: 1.3;
}

.arch-desc {
  margin: 0.35rem 0 0;
  font-size: 0.82rem;
  color: var(--vp-c-text-2);
  line-height: 1.45;
}

.arch-desc code {
  font-size: 0.78rem;
}

.arch-desc--mono {
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
}

.arch-pipeline {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  margin: 0.5rem 0 0;
}

.arch-phase {
  font-family: var(--vp-font-family-mono);
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  padding: 0.15rem 0.45rem;
  border-radius: 6px;
  background: var(--vp-c-bg);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 25%, var(--vp-c-border));
}

.arch-phase-sep {
  color: var(--vp-c-text-3);
  font-size: 0.85rem;
}

.arch-bridge {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.45rem 0;
}

.arch-bridge-line {
  flex: 1;
  height: 1px;
  background: var(--vp-c-divider);
}

.arch-bridge-label {
  flex-shrink: 0;
  font-size: 0.68rem;
  font-weight: 500;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
}

.arch-flows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.arch-flow {
  display: grid;
  grid-template-columns: 1fr auto auto;
  grid-template-rows: auto auto;
  gap: 0.15rem 0.4rem;
  align-items: center;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
}

.arch-flow-node {
  grid-column: 1;
  grid-row: 1 / 3;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.arch-flow-name {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  line-height: 1.3;
  word-break: break-word;
}

.arch-flow-desc {
  font-size: 0.72rem;
  color: var(--vp-c-text-2);
  line-height: 1.3;
}

.arch-flow-arrow {
  grid-column: 2;
  grid-row: 1 / 3;
  color: var(--vp-c-text-3);
  font-size: 0.9rem;
  line-height: 1;
}

.arch-flow-target {
  grid-column: 3;
  grid-row: 1;
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--vp-c-text-1);
  text-align: right;
  white-space: nowrap;
}

.arch-tag {
  grid-column: 3;
  grid-row: 2;
  justify-self: end;
  font-size: 0.62rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--vp-c-text-2);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  white-space: nowrap;
}

.arch-tag--live {
  color: var(--vp-c-brand-1);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 30%, var(--vp-c-divider));
  background: color-mix(in srgb, var(--vp-c-brand-soft) 50%, var(--vp-c-bg-soft));
}

.arch-endpoint {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  padding: 0.75rem 0.9rem;
  border-radius: var(--arch-radius);
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.arch-endpoint-title {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.arch-endpoint-desc {
  margin: 0.1rem 0 0;
  font-size: 0.74rem;
  color: var(--vp-c-text-2);
}

.arch-endpoint-role {
  margin-left: auto;
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

@media (max-width: 640px) {
  .arch-layer--split {
    grid-template-columns: 1fr;
  }

  .arch-layer--endpoints {
    grid-template-columns: 1fr;
  }

  .arch-flow {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }

  .arch-flow-node {
    grid-row: auto;
  }

  .arch-flow-arrow {
    display: none;
  }

  .arch-flow-target,
  .arch-tag {
    grid-column: 1;
    justify-self: start;
    text-align: left;
  }

  .arch-flow-target {
    margin-top: 0.25rem;
  }

  .arch-flow-target::before {
    content: '→ ';
    color: var(--vp-c-text-3);
  }
}
</style>
