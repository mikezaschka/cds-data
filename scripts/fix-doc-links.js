#!/usr/bin/env node
/**
 * One-shot link hygiene for the monorepo doc migration.
 * Replaces stale cds-data-federation repo paths, test/delegation/, and Pages URLs.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', '.claude/worktrees', 'app/pipeline-console']);

const REPLACEMENTS = [
  // GitHub repo + monorepo path prefixes
  [
    /https:\/\/github\.com\/mikezaschka\/cds-data-federation\/blob\/main\/test\/delegation\/basic\.test\.js/g,
    'https://github.com/mikezaschka/cds-data/blob/main/packages/cds-data-federation/test/integration/delegate/basic.test.js',
  ],
  [
    /https:\/\/github\.com\/mikezaschka\/cds-data-federation\/blob\/main\/test\/delegation\/cross-service-expand-local-to-remote\.test\.js/g,
    'https://github.com/mikezaschka/cds-data/blob/main/packages/cds-data-federation/test/integration/expand-local-to-remote/cross-service-expand-local-to-remote.test.js',
  ],
  [
    /https:\/\/github\.com\/mikezaschka\/cds-data-federation\/blob\/main\/test\/delegation\/cross-service-expand-remote-to-local\.test\.js/g,
    'https://github.com/mikezaschka/cds-data/blob/main/packages/cds-data-federation/test/integration/expand-remote-to-local/cross-service-expand-remote-to-local.test.js',
  ],
  [
    /https:\/\/github\.com\/mikezaschka\/cds-data-federation\/blob\/main\/test\/delegation\/cross-service-navigation\.test\.js/g,
    'https://github.com/mikezaschka/cds-data/blob/main/packages/cds-data-federation/test/integration/navigation/cross-service-navigation.test.js',
  ],
  [
    /https:\/\/github\.com\/mikezaschka\/cds-data-federation\/tree\/main\/test\/delegation\/?/g,
    'https://github.com/mikezaschka/cds-data/tree/main/packages/cds-data-federation/test/integration',
  ],
  [
    /https:\/\/github\.com\/mikezaschka\/cds-data-federation\/blob\/main\/test\/delegation\.test\.js/g,
    'https://github.com/mikezaschka/cds-data/tree/main/packages/cds-data-federation/test/integration',
  ],
  [
    /https:\/\/github\.com\/mikezaschka\/cds-data-federation\/blob\/main\/test\/replication\.test\.js/g,
    'https://github.com/mikezaschka/cds-data/tree/main/packages/cds-data-pipeline/test/integration',
  ],
  [
    /https:\/\/github\.com\/mikezaschka\/cds-data-federation\/blob\/main\/test\/consumer\//g,
    'https://github.com/mikezaschka/cds-data/blob/main/packages/cds-data-federation/test/fixtures/consumer/',
  ],
  [
    /https:\/\/github\.com\/mikezaschka\/cds-data-federation\/blob\/main\/srv\//g,
    'https://github.com/mikezaschka/cds-data/blob/main/packages/cds-data-federation/srv/',
  ],
  [
    /https:\/\/github\.com\/mikezaschka\/cds-data-federation\/tree\/main\/examples/g,
    'https://github.com/mikezaschka/cds-data/tree/main/examples',
  ],
  [
    /https:\/\/github\.com\/mikezaschka\/cds-data-federation\/blob\/main\/README\.md/g,
    'https://github.com/mikezaschka/cds-data/blob/main/packages/cds-data-federation/README.md',
  ],
  [
    /https:\/\/github\.com\/mikezaschka\/cds-data-federation\/blob\/main\/examples\/README\.md/g,
    'https://github.com/mikezaschka/cds-data/blob/main/examples/README.md',
  ],
  [
    /https:\/\/github\.com\/mikezaschka\/cds-data-federation(?![/\w-])/g,
    'https://github.com/mikezaschka/cds-data',
  ],
  // Inline path references (non-URL)
  [/[`[]test\/delegation\/basic\.test\.js[`\]]/g, '`packages/cds-data-federation/test/integration/delegate/basic.test.js`'],
  [/test\/delegation\/basic\.test\.js/g, 'packages/cds-data-federation/test/integration/delegate/basic.test.js'],
  [
    /test\/delegation\/cross-service-expand-local-to-remote\.test\.js/g,
    'packages/cds-data-federation/test/integration/expand-local-to-remote/cross-service-expand-local-to-remote.test.js',
  ],
  [
    /test\/delegation\/cross-service-expand-remote-to-local\.test\.js/g,
    'packages/cds-data-federation/test/integration/expand-remote-to-local/cross-service-expand-remote-to-local.test.js',
  ],
  [
    /test\/delegation\/cross-service-navigation\.test\.js/g,
    'packages/cds-data-federation/test/integration/navigation/cross-service-navigation.test.js',
  ],
  [/test\/delegation\.test\.js/g, 'packages/cds-data-federation/test/integration/'],
  [/test\/replication\.test\.js/g, 'packages/cds-data-pipeline/test/integration/'],
  [/test\/delegation\//g, 'packages/cds-data-federation/test/integration/'],
  [/test\/delegation\/\*\.test\.js/g, 'packages/cds-data-federation/test/integration/**/*.test.js'],
  [/test\/unit\.test\.js/g, 'packages/cds-data-federation/test/unit/ or packages/cds-data-pipeline/test/unit/'],
  // GitHub Pages — unified site (https://mikezaschka.github.io/cds-data/)
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data-federation\/cds-data-federation\/getting-started\/joining-local-with-remote\/?/g,
    '/federation/getting-started/joining-local-with-remote',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data\/cds-data-federation\/getting-started\/joining-local-with-remote\/?/g,
    '/federation/getting-started/joining-local-with-remote',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data-federation\/cds-data-federation\/getting-started\/extending-remote-with-local\/?/g,
    '/federation/getting-started/extending-remote-with-local',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data\/cds-data-federation\/getting-started\/extending-remote-with-local\/?/g,
    '/federation/getting-started/extending-remote-with-local',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data-federation\/cds-data-federation\//g,
    '/federation/',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data\/cds-data-federation\//g,
    '/federation/',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data-federation\/cds-data-pipeline\/concepts\/inference\/?/g,
    '/pipeline/guide/concepts/inference',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data\/cds-data-pipeline\/concepts\/inference\/?/g,
    '/pipeline/guide/concepts/inference',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data-federation\/cds-data-pipeline\/reference\/management-service\/?/g,
    '/pipeline/reference/management-service',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data\/cds-data-pipeline\/reference\/management-service\/?/g,
    '/pipeline/reference/management-service',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data-federation\/cds-data-pipeline\//g,
    '/pipeline/',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data\/cds-data-pipeline\//g,
    '/pipeline/',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data-federation\/pipeline\//g,
    'https://mikezaschka.github.io/cds-data/pipeline/',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data-federation\/federation\//g,
    'https://mikezaschka.github.io/cds-data/federation/',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data-federation\/materialization\//g,
    'https://mikezaschka.github.io/cds-data/materialization/',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data-federation\/?/g,
    'https://mikezaschka.github.io/cds-data/',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data-pipeline\/guide\/concepts\/inference\.html/g,
    'https://mikezaschka.github.io/cds-data/pipeline/guide/concepts/inference',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data-pipeline\/guide\/concepts\/consumption-views\.html/g,
    'https://mikezaschka.github.io/cds-data/pipeline/guide/concepts/consumption-views',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data-pipeline\/guide\/sources\/custom\.html/g,
    'https://mikezaschka.github.io/cds-data/pipeline/guide/sources/custom',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data-pipeline\/guide\/targets\/custom\.html/g,
    'https://mikezaschka.github.io/cds-data/pipeline/guide/targets/custom',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data-pipeline\/guide\/get-started\.html/g,
    'https://mikezaschka.github.io/cds-data/pipeline/guide/get-started',
  ],
  [
    /https:\/\/mikezaschka\.github\.io\/cds-data-pipeline\/?/g,
    'https://mikezaschka.github.io/cds-data/pipeline/',
  ],
  // Broken internal doc link in requirements
  [
    /docs\/pipeline\/integration\/cqn\.md/g,
    'docs/pipeline/guide/sources/cqn.md',
  ],
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(ROOT, path.join(dir, entry.name));
    if (SKIP.has(entry.name) || [...SKIP].some((s) => rel.startsWith(s))) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

let changed = 0;
for (const file of walk(ROOT)) {
  let text = fs.readFileSync(file, 'utf8');
  const before = text;
  for (const [from, to] of REPLACEMENTS) text = text.replace(from, to);
  if (text !== before) {
    fs.writeFileSync(file, text);
    changed++;
    console.log('updated:', path.relative(ROOT, file));
  }
}
console.log(`Done. ${changed} files updated.`);
