const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { VB6Indexer } = require('../out/server/indexer/indexer.js');
const { handleSemanticTokens } = require('../out/server/providers/semanticTokens.js');

test('semantic tokens are produced for indexed declarations', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'advanced-workspace');
  const sourceDir = path.join(rootDir, 'App', 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();

  const uri = pathToFileURL(path.join(sourceDir, 'clsWorker.cls')).href;
  const tokens = handleSemanticTokens({ textDocument: { uri } }, indexer.getIndex());

  assert.ok(Array.isArray(tokens.data));
  assert.ok(tokens.data.length > 0);
});
