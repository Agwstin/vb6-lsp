const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { VB6Indexer } = require('../out/server/indexer/indexer.js');
const { resolveWorkspaceConfig } = require('../out/server/config.js');
const { computeDiagnostics } = require('../out/server/providers/diagnostics.js');

test('diagnostics warn when a With receiver cannot be resolved', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'advanced-workspace');
  const sourceDir = path.join(rootDir, 'App', 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();
  const config = resolveWorkspaceConfig({
    rootUri: `file:///${rootDir.replace(/\\/g, '/')}`,
    settings: {},
  });

  const filePath = path.join(sourceDir, 'modMemberAccess.bas');
  const diagnostics = computeDiagnostics(filePath, indexer.getIndex(), config);

  assert.ok(diagnostics.some((diagnostic) => diagnostic.message.includes("Unresolved With receiver 'MissingWorker'")));
});
