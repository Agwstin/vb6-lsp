const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { VB6Indexer } = require('../out/server/indexer/indexer.js');

test('indexer captures Implements statements and Type fields', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'advanced-workspace');
  const sourceDir = path.join(rootDir, 'App', 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();
  const index = indexer.getIndex();

  const implementsSymbols = index.byName.get('iworker') || [];
  assert.ok(implementsSymbols.some((symbol) => symbol.kind === 'Implements'));

  const nameFields = index.byName.get('name') || [];
  assert.ok(nameFields.some((symbol) => symbol.kind === 'Field' && symbol.containerName === 'tPlayerState'));

  const levelFields = index.byName.get('level') || [];
  assert.ok(levelFields.some((symbol) => symbol.kind === 'Field' && symbol.containerName === 'tPlayerState'));
});
