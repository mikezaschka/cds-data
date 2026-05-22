# Shared pipeline UI5 apps

Two **UI5 Tooling 3** applications used by every example under `examples/0x-*/`:

| Package | Role |
|--------|------|
| `pipeline-monitor/` | Fiori Elements list / object page on `DataPipelineManagementService` |
| `pipeline-console/` | Freestyle FCL console (master / detail / runs) |

Each example’s `package.json` declares them as **`file:` devDependencies** and **[cds-plugin-ui5](https://github.com/ui5-community/ui5-ecosystem-showcase/tree/main/packages/cds-plugin-ui5)** mounts them at `/pipeline-monitor` and `/pipeline-console`. The sandbox launchpad is a single file, [`launchpage.html`](launchpage.html); each example’s `app/launchpage.html` is a **symlink** to it (same tile URLs on any port). On **Windows**, enable Git symlinks (Developer Mode or `core.symlinks=true` with a clone that preserves them) or replace the symlink with a small copy step if your environment does not support links.

## Build

From this directory (installs workspace tooling once):

```bash
cd examples/_ui-pipeline && npm install && npm run build
```

Or from any example: `npm run ui:build` (runs the same build via `--prefix`).

## Source

Fiori CDS annotations for the list/object pages remain in the plugin at [`../../srv/monitor-annotations.cds`](../../srv/monitor-annotations.cds).
