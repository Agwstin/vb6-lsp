const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { VB6Indexer } = require('../out/server/indexer/indexer.js');
const { handleFoldingRanges } = require('../out/server/providers/foldingRanges.js');

test('folding ranges are emitted for multiline routines', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'advanced-workspace');
  const sourceDir = path.join(rootDir, 'App', 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();

  const uri = pathToFileURL(path.join(sourceDir, 'clsWorker.cls')).href;
  const ranges = handleFoldingRanges({ textDocument: { uri } }, indexer.getIndex());

  assert.ok(ranges.some((range) => range.startLine <= 9 && range.endLine >= 10));
});
