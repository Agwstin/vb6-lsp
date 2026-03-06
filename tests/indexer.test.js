const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { VB6Indexer } = require('../out/server/indexer/indexer.js');

test('indexer captures module symbols, parameters, locals and canonical property names', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'sample-workspace');
  const sourceDirs = [
    path.join(rootDir, 'Client', 'source'),
    path.join(rootDir, 'Common'),
  ];

  const indexer = new VB6Indexer(rootDir, sourceDirs);
  indexer.buildFullIndex();
  const index = indexer.getIndex();

  const sharedValue = index.byName.get('sharedvalue') || [];
  assert.ok(sharedValue.some((symbol) => symbol.kind === 'Property' && symbol.name === 'SharedValue'));

  const localCounter = index.byName.get('localcounter') || [];
  assert.ok(localCounter.some((symbol) => symbol.scope === 'local' && symbol.containerName === 'Demo'));
  assert.ok(localCounter.some((symbol) => symbol.scope === 'local' && symbol.containerName === 'UseShared'));

  const countSymbols = index.byName.get('count') || [];
  assert.ok(countSymbols.some((symbol) => symbol.kind === 'Parameter' && symbol.scope === 'parameter'));
});
