const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { VB6Indexer } = require('../out/server/indexer/indexer.js');
const { computeDiagnostics } = require('../out/server/providers/diagnostics.js');
const { handleCodeActions } = require('../out/server/providers/codeActions.js');

test('code actions suggest adding Option Explicit', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'code-actions-workspace');
  const sourceDir = path.join(rootDir, 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();

  const filePath = path.join(sourceDir, 'modMissingOption.bas');
  const diagnostics = computeDiagnostics(filePath, indexer.getIndex());
  const actions = handleCodeActions({
    textDocument: { uri: pathToFileURL(filePath).href },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    context: { diagnostics },
  });

  assert.ok(actions.some((action) => action.title === 'Add Option Explicit'));
});

test('code actions suggest adding missing End statements', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'code-actions-workspace');
  const sourceDir = path.join(rootDir, 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();

  const filePath = path.join(sourceDir, 'modMissingEnd.bas');
  const diagnostics = computeDiagnostics(filePath, indexer.getIndex());
  const actions = handleCodeActions({
    textDocument: { uri: pathToFileURL(filePath).href },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    context: { diagnostics },
  });

  assert.ok(actions.some((action) => action.title === 'Add End Sub'));
});

test('code actions suggest changing duplicate Public symbols to Private', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'code-actions-workspace');
  const sourceDir = path.join(rootDir, 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();

  const filePath = path.join(sourceDir, 'modDuplicatePublic.bas');
  const diagnostics = computeDiagnostics(filePath, indexer.getIndex());
  const actions = handleCodeActions({
    textDocument: { uri: pathToFileURL(filePath).href },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    context: { diagnostics },
  });

  assert.ok(actions.some((action) => action.title === 'Change Public to Private'));
});
