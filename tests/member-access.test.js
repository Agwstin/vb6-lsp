const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { TextDocument } = require('vscode-languageserver-textdocument');

const { VB6Indexer } = require('../out/server/indexer/indexer.js');
const { handleCompletion } = require('../out/server/providers/completion.js');
const { handleDefinition } = require('../out/server/providers/definition.js');

test('member access completion resolves class members and UDT fields', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'advanced-workspace');
  const sourceDir = path.join(rootDir, 'App', 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();

  const filePath = path.join(sourceDir, 'modMemberAccess.bas');
  const uri = pathToFileURL(filePath).href;
  const text = fs.readFileSync(filePath, 'latin1');
  const document = TextDocument.create(uri, 'vb6', 1, text);

  const classItems = handleCompletion(
    { textDocument: { uri }, position: { line: 5, character: 11 } },
    { get: () => document },
    indexer.getIndex(),
  );
  assert.ok(classItems.some((item) => item.label === 'ProcessOrder'));
  assert.ok(classItems.some((item) => item.label === 'DisplayName'));

  const udtItems = handleCompletion(
    { textDocument: { uri }, position: { line: 9, character: 18 } },
    { get: () => document },
    indexer.getIndex(),
  );
  assert.ok(udtItems.some((item) => item.label === 'Name'));
  assert.ok(udtItems.some((item) => item.label === 'Level'));
});

test('member access definition resolves class properties', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'advanced-workspace');
  const sourceDir = path.join(rootDir, 'App', 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();

  const filePath = path.join(sourceDir, 'modMemberAccess.bas');
  const uri = pathToFileURL(filePath).href;
  const text = fs.readFileSync(filePath, 'latin1').replace('worker.', 'worker.DisplayName');
  const document = TextDocument.create(uri, 'vb6', 1, text);

  const locations = handleDefinition(
    { textDocument: { uri }, position: { line: 5, character: 18 } },
    { get: () => document },
    indexer.getIndex(),
  );

  assert.ok(Array.isArray(locations));
  assert.equal(locations.length, 1);
  assert.ok(locations[0].uri.includes('clsWorker.cls'));
});
