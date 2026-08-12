const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { CancellationTokenSource } = require('vscode-jsonrpc');
const { TextDocument } = require('vscode-languageserver-textdocument');

const { VB6Indexer } = require('../out/server/indexer/indexer.js');
const { handleReferences } = require('../out/server/providers/references.js');

function createDocument(filePath) {
  return TextDocument.create(
    pathToFileURL(filePath).href,
    'vb6',
    1,
    fs.readFileSync(filePath, 'latin1'),
  );
}

test('references stop cleanly when the LSP request is already cancelled', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'sample-workspace');
  const sourceDirs = [
    path.join(rootDir, 'Client', 'source'),
    path.join(rootDir, 'Common'),
  ];
  const indexer = new VB6Indexer(rootDir, sourceDirs);
  indexer.buildFullIndex();

  const filePath = path.join(rootDir, 'Client', 'source', 'modSample.bas');
  const document = createDocument(filePath);
  const documents = { get: (uri) => (uri === document.uri ? document : undefined) };
  const line = document.getText().split(/\r?\n/).findIndex((value) => value.includes('UseShared'));
  const character = document.getText().split(/\r?\n/)[line].indexOf('UseShared') + 2;
  const cancellation = new CancellationTokenSource();
  cancellation.cancel();

  const result = handleReferences(
    {
      textDocument: { uri: document.uri },
      position: { line, character },
      context: { includeDeclaration: false },
    },
    documents,
    indexer.getIndex(),
    undefined,
    cancellation.token,
  );

  assert.equal(result, null);
});

test('references stop between source reads when cancellation arrives mid-scan', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'sample-workspace');
  const sourceDirs = [
    path.join(rootDir, 'Client', 'source'),
    path.join(rootDir, 'Common'),
  ];
  const indexer = new VB6Indexer(rootDir, sourceDirs);
  indexer.buildFullIndex();

  const filePath = path.join(rootDir, 'Client', 'source', 'modSample.bas');
  const document = createDocument(filePath);
  const documents = { get: (uri) => (uri === document.uri ? document : undefined) };
  const line = document.getText().split(/\r?\n/).findIndex((value) => value.includes('UseShared'));
  const character = document.getText().split(/\r?\n/)[line].indexOf('UseShared') + 2;
  const cancellation = new CancellationTokenSource();
  let reads = 0;
  const source = {
    getOpenText: () => undefined,
    readText: () => null,
    readLines: (targetPath) => {
      reads += 1;
      cancellation.cancel();
      return fs.readFileSync(targetPath, 'latin1').split(/\r?\n/);
    },
  };

  const result = handleReferences(
    {
      textDocument: { uri: document.uri },
      position: { line, character },
      context: { includeDeclaration: false },
    },
    documents,
    indexer.getIndex(),
    source,
    cancellation.token,
  );

  assert.equal(result, null);
  assert.equal(reads, 1);
});
