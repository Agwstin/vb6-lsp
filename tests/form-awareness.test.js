const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { VB6Indexer } = require('../out/server/indexer/indexer.js');
const { handleDocumentSymbol } = require('../out/server/providers/documentSymbol.js');

test('frm designer controls are indexed as members of the form', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'advanced-workspace');
  const sourceDir = path.join(rootDir, 'App', 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();
  const index = indexer.getIndex();

  const controlSymbols = index.byName.get('cmdaccept') || [];
  assert.ok(controlSymbols.some((symbol) => symbol.kind === 'Field' && symbol.containerName === 'frmMain'));

  const uri = pathToFileURL(path.join(sourceDir, 'frmMain.frm')).href;
  const documentSymbols = handleDocumentSymbol({ textDocument: { uri } }, index);
  assert.ok(controlSymbols.length > 0);
  assert.ok(documentSymbols.some((symbol) => symbol.name === 'cmdAccept'));
});
