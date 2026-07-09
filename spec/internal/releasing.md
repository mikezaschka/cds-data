# Releasing packages

Local release tooling mirrors [cds-caching](https://github.com/mikezaschka/cds-caching): [`release-it`](https://github.com/release-it/release-it) + [`@release-it/conventional-changelog`](https://github.com/release-it/conventional-changelog), run from a maintainer machine. CI (`.github/workflows/test.yml`) stays test-only; it does not publish.

## Packages in scope

| Package | npm name | Release command |
|---|---|---|
| Pipeline engine | `cds-data-pipeline` | `npm run release:pipeline` |
| Federation plugin | `cds-data-federation` | `npm run release:federation` |

`cds-data-materialization` is not wired for release yet; the same pattern will apply when it is ready.

## Prerequisites

1. **npm auth** — `npm login` or a valid `NPM_TOKEN` in your environment.
2. **GitHub auth** — `release-it` creates GitHub Releases; ensure `gh auth login` or a `GITHUB_TOKEN` with repo scope.
3. **Clean working tree** — commit or stash local changes before releasing.
4. **Conventional commits** — use `feat:` / `fix:` (and other [Conventional Commits](https://www.conventionalcommits.org/) types) on changes under the package directory. Changelog generation is path-scoped to `packages/<pkg>/`.

## First publish

Publish **`cds-data-pipeline` before `cds-data-federation`**. Federation declares `cds-data-pipeline` as a peer dependency (`>=0.1.0`); consumers need the engine on npm before federation can resolve cleanly.

## Release flow

From the repository root:

```bash
# Pipeline (runs tests, bumps version, updates CHANGELOG, tags, pushes, publishes)
npm run release:pipeline

# Federation (independent version; only federation-scoped commits affect its bump)
npm run release:federation
```

Each release:

1. Runs that package's test suite (`hooks.before:init`).
2. Computes the next version from conventional commits scoped to the package path.
3. Updates `packages/<pkg>/CHANGELOG.md` and `package.json`.
4. Commits, tags (`cds-data-pipeline@X.Y.Z` or `cds-data-federation@X.Y.Z`), and pushes.
5. Runs `prepublishOnly` if defined (pipeline builds the Pipeline Console UI).
6. Publishes to npm and creates a GitHub Release for the tag.

## Dry run

Preview without publishing:

```bash
npm run release -w cds-data-pipeline -- --dry-run
npm run release -w cds-data-federation -- --dry-run
```

## Explicit version

To promote to a specific version (e.g. first stable `1.0.0`):

```bash
npm run release -w cds-data-pipeline -- 1.0.0
```

## Independent versioning

Pipeline and federation version independently. A fix in pipeline does not bump federation, and vice versa. Federation's peer range (`cds-data-pipeline >=0.1.0`) does not force lockstep bumps — document breaking peer requirements in federation's release notes when they change.

## Configuration

Per-package config lives in:

- [`packages/cds-data-pipeline/.release-it.json`](../../packages/cds-data-pipeline/.release-it.json)
- [`packages/cds-data-federation/.release-it.json`](../../packages/cds-data-federation/.release-it.json)

Root [`package.json`](../../package.json) holds the shared devDependencies and convenience scripts.
