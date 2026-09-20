# Changelog

## [0.4.0](https://github.com/mikezaschka/cds-data/compare/cds-data-federation@0.3.3...cds-data-federation@0.4.0) (2026-09-20)

### Bug Fixes

* **federation:** align local V2 null comparisons ([0220bd3](https://github.com/mikezaschka/cds-data/commit/0220bd356fb080d7b4c614987870a491cf8deda9))
* **federation:** avoid repeated remote counts ([ea8c224](https://github.com/mikezaschka/cds-data/commit/ea8c22425c82765e264c4823e9eec808ecfbb9a0))
* **federation:** correct delegation and replication against real remotes ([6f3f647](https://github.com/mikezaschka/cds-data/commit/6f3f64715121203b1980009c0c7bdaca75110187))
* **federation:** enforce V2 expand predicates locally ([7636197](https://github.com/mikezaschka/cds-data/commit/7636197727606dbf0e689676091f16eaa6aad5b1))
* **federation:** evaluate wrapped V2 ordering ([6ea8135](https://github.com/mikezaschka/cds-data/commit/6ea8135f7352c3c7ea9eeade653f1c323ab08ead))
* **federation:** expose accurate replicate freshness ([5fcf7a9](https://github.com/mikezaschka/cds-data/commit/5fcf7a97446661f243cbfa5d5ca0d3edf399deb8))
* **federation:** handle V2 static-scope expand targets on direct queries ([19f044b](https://github.com/mikezaschka/cds-data/commit/19f044b10056ffaa4f04e2e0915372a9bc977a66))
* **federation:** infer types for reversed predicates ([b1645df](https://github.com/mikezaschka/cds-data/commit/b1645df67642c20cbcc20b52fa57f3b310ab6c8d))
* **federation:** page cross-service expands and navigation filters ([cd8d251](https://github.com/mikezaschka/cds-data/commit/cd8d25198e5678131ede98e0d02e8ce41296adde))
* **federation:** preserve local predicate mappings ([1995a0c](https://github.com/mikezaschka/cds-data/commit/1995a0ca5fbfac119abaaa70fcdd39e409fae69b))
* **federation:** preserve V2 expand semantics ([5c40413](https://github.com/mikezaschka/cds-data/commit/5c40413d136863f3802083f9c1f103da429f2be8))
* **federation:** preserve V2 query semantics ([43a598f](https://github.com/mikezaschka/cds-data/commit/43a598f9910403c02d30e1c8a3f8c14f1dee8d0b))
* **federation:** restore projection-chain semantics on the direct-remote path ([1be0329](https://github.com/mikezaschka/cds-data/commit/1be032948bc15b6ac146002ff0522af44c040060))
* **federation:** stamp freshness only during replication ([b25c27b](https://github.com/mikezaschka/cds-data/commit/b25c27b30208b4e196b5815a2a3d7df8a479775d))
* normalize static-where expand columns ([#1](https://github.com/mikezaschka/cds-data/issues/1)) ([b8d2a00](https://github.com/mikezaschka/cds-data/commit/b8d2a008de663558c34adf41495d9f5e6065f3cd))
* **test:** bind xtravels' remotes the way CAP resolves them ([fdfaa19](https://github.com/mikezaschka/cds-data/commit/fdfaa194deb8f02a81cbfae07d2fe706dd47d99f))
* translate nested expand options ([92bc275](https://github.com/mikezaschka/cds-data/commit/92bc275b0c2b15ea288ef7cff83ccd97e36be15d))
* translate renamed association foreign keys on the direct-remote path ([d8ea880](https://github.com/mikezaschka/cds-data/commit/d8ea880a19d890c7c5847a83af325f79fe643427))

## [0.3.3](https://github.com/mikezaschka/cds-data/compare/cds-data-federation@0.3.2...cds-data-federation@0.3.3) (2026-07-17)


### Bug Fixes

* **service-resolution:** update service type check to include isAppService property

## [0.3.2](https://github.com/mikezaschka/cds-data/compare/cds-data-federation@0.3.1...cds-data-federation@0.3.2) (2026-07-12)


### Documentation

* add Beyond CAP section and slim strategy picker
* refresh package READMEs and add Pipeline Console screenshots

## [0.3.1](https://github.com/mikezaschka/cds-data/compare/cds-data-federation@0.3.0...cds-data-federation@0.3.1) (2026-07-11)


### Bug Fixes

* recognize join-based derived read models in scanner

## [0.3.0](https://github.com/mikezaschka/cds-data/compare/cds-data-federation@0.2.1...cds-data-federation@0.3.0) (2026-07-11)


### ⚠ BREAKING CHANGES

* align plugin service and config keys to kebab-case defaults

### Features

* always set a meaningful pipeline description

### Bug Fixes

* honor configured entity-cache serviceName; rename default to kebab-case

### Documentation

* add CQN transform examples and debug logging
* mark AI assistant guidance as coming soon
* add shields.io badges to root and package READMEs

## [0.2.1](https://github.com/mikezaschka/cds-data/compare/cds-data-federation@0.2.0...cds-data-federation@0.2.1) (2026-07-11)


### Features

* resolve remote→local navigation path `$filters`

### Bug Fixes

* extract renames from `as select from` consumption views

## 0.2.0 (2026-07-10)


### Features

* refactor entity cache and add HCQL and MCP integration
* add Pipeline Console launchpad to mcp-federation example
