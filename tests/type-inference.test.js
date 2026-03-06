const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { TextDocument } = require('vscode-languageserver-textdocument');

const { VB6Indexer } = require('../out/server/indexer/indexer.js');
const { resolveSymbolSet } = require('../out/server/resolution.js');
const { inferResolvedSymbolType } = require('../out/server/typeInference.js');

test('type inference detects New assignments for Variant locals', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'advanced-workspace');
  const sourceDir = path.join(rootDir, 'App', 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();

  const filePath = path.join(sourceDir, 'modInference.bas');
  const uri = pathToFileURL(filePath).href;
  const text = fs.readFileSync(filePath, 'latin1');
  const document = TextDocument.create(uri, 'vb6', 1, text);

  const resolved = resolveSymbolSet(indexer.getIndex(), 'worker', filePath, 6);
  const inferredType = inferResolvedSymbolType(indexer.getIndex(), resolved, filePath, 6, document);

  assert.equal(inferredType, 'clsWorker');
});

test('type inference follows assignments from typed variables and functions', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'advanced-workspace');
  const sourceDir = path.join(rootDir, 'App', 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();

  const filePath = path.join(sourceDir, 'modInference.bas');
  const uri = pathToFileURL(filePath).href;
  const text = fs.readFileSync(filePath, 'latin1');
  const document = TextDocument.create(uri, 'vb6', 1, text);

  const fromVariable = resolveSymbolSet(indexer.getIndex(), 'secondWorker', filePath, 14);
  const inferredFromVariable = inferResolvedSymbolType(indexer.getIndex(), fromVariable, filePath, 14, document);
  assert.equal(inferredFromVariable, 'clsWorker');

  const fromFunction = resolveSymbolSet(indexer.getIndex(), 'worker', filePath, 20);
  const inferredFromFunction = inferResolvedSymbolType(indexer.getIndex(), fromFunction, filePath, 20, document);
  assert.equal(inferredFromFunction, 'clsWorker');
});
