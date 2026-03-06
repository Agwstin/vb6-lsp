const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { TextDocument } = require('vscode-languageserver-textdocument');

const { VB6Indexer } = require('../out/server/indexer/indexer.js');
const { handleCompletion } = require('../out/server/providers/completion.js');

test('completion prioritizes local symbols over broader matches', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'advanced-workspace');
  const sourceDir = path.join(rootDir, 'App', 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();

  const filePath = path.join(sourceDir, 'modCompletion.bas');
  const text = require('node:fs').readFileSync(filePath, 'latin1');
  const document = TextDocument.create(pathToFileURL(filePath).href, 'vb6', 1, text);

  const items = handleCompletion(
    {
      textDocument: { uri: document.uri },
      position: { line: 7, character: 8 },
    },
    { get: () => document },
    indexer.getIndex(),
  );

  assert.ok(items.length >= 2);
  assert.equal(items[0].label, 'localCounter');
});
