const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { TextDocument } = require('vscode-languageserver-textdocument');

const { VB6Indexer } = require('../out/server/indexer/indexer.js');
const { computeDiagnostics } = require('../out/server/providers/diagnostics.js');
const { handleCodeActions } = require('../out/server/providers/codeActions.js');
const { handleHover } = require('../out/server/providers/hover.js');
const { handlePrepareRename, handleRename } = require('../out/server/providers/rename.js');
const { handleSignatureHelp } = require('../out/server/providers/signatureHelp.js');
const { handleWorkspaceSymbol } = require('../out/server/providers/workspaceSymbol.js');

function documentsFor(document) {
  return { get: (uri) => (uri === document.uri ? document : undefined) };
}

function createDocument(filePath, text = fs.readFileSync(filePath, 'latin1')) {
  return TextDocument.create(pathToFileURL(filePath).href, 'vb6', 1, text);
}

function sampleIndex() {
  const rootDir = path.resolve(__dirname, 'fixtures', 'sample-workspace');
  const sourceDirs = [
    path.join(rootDir, 'Client', 'source'),
    path.join(rootDir, 'Common'),
  ];
  const indexer = new VB6Indexer(rootDir, sourceDirs);
  indexer.buildFullIndex();
  return { rootDir, sourceDirs, index: indexer.getIndex() };
}

test('hover and signature help expose the indexed VB6 contract', () => {
  const { index } = sampleIndex();
  const sharedPath = path.join(__dirname, 'fixtures', 'sample-workspace', 'Common', 'modShared.bas');
  const sharedDocument = createDocument(sharedPath);
  const sharedUri = sharedDocument.uri;
  const hoverLine = 11;
  const hoverCharacter = sharedDocument.getText().split(/\r?\n/)[hoverLine].indexOf('SharedValue') + 2;
  const hover = handleHover(
    { textDocument: { uri: sharedUri }, position: { line: hoverLine, character: hoverCharacter } },
    documentsFor(sharedDocument),
    index,
  );
  assert.ok(hover);
  assert.match(hover.contents.value, /Public Property Get SharedValue\(\) As Long/);
  assert.match(hover.contents.value, /modShared\.bas/);

  const samplePath = path.join(__dirname, 'fixtures', 'sample-workspace', 'Client', 'source', 'modSample.bas');
  const sampleDocument = createDocument(samplePath);
  const callLine = 6;
  const callText = sampleDocument.getText().split(/\r?\n/)[callLine];
  const signature = handleSignatureHelp(
    {
      textDocument: { uri: sampleDocument.uri },
      position: { line: callLine, character: callText.indexOf('(') + 1 },
    },
    documentsFor(sampleDocument),
    index,
  );
  assert.ok(signature);
  assert.equal(signature.activeParameter, 0);
  assert.match(signature.signatures[0].label, /UseShared\(ByVal count As Long\)/);
  assert.equal(signature.signatures[0].parameters[0].label, 'ByVal count As Long');
});

test('rename returns exact edits and rejects an ambiguous public definition', () => {
  const { index } = sampleIndex();
  const samplePath = path.join(__dirname, 'fixtures', 'sample-workspace', 'Client', 'source', 'modSample.bas');
  const document = createDocument(samplePath);
  const line = 6;
  const character = document.getText().split(/\r?\n/)[line].indexOf('UseShared') + 2;
  const prepare = handlePrepareRename(
    { textDocument: { uri: document.uri }, position: { line, character } },
    documentsFor(document),
    index,
  );
  assert.deepEqual(prepare, { start: { line, character: 9 }, end: { line, character: 18 } });

  const renamed = handleRename(
    {
      textDocument: { uri: document.uri },
      position: { line, character },
      newName: 'UseSharedRenamed',
    },
    documentsFor(document),
    index,
  );
  assert.ok(renamed);
  const edits = Object.values(renamed.changes).flat();
  assert.ok(edits.some((edit) => edit.range.start.line === line && edit.range.start.character === 9 && edit.range.end.character === 18));
  assert.ok(edits.every((edit) => edit.newText === 'UseSharedRenamed'));

  const projectRoot = path.resolve(__dirname, 'fixtures', 'project-scope-workspace');
  const projectSources = [
    path.join(projectRoot, 'AppA', 'source'),
    path.join(projectRoot, 'AppB', 'source'),
    path.join(projectRoot, 'AppC', 'source'),
  ];
  const projectIndexer = new VB6Indexer(projectRoot, projectSources);
  projectIndexer.buildFullIndex();
  const duplicatePath = path.join(projectRoot, 'AppC', 'source', 'modSharedDuplicate.bas');
  const duplicateText = `${fs.readFileSync(duplicatePath, 'latin1')}\r\nPublic Sub Caller()\r\n    Call SharedEntry()\r\nEnd Sub\r\n`;
  const duplicateDocument = createDocument(duplicatePath, duplicateText);
  const duplicateLines = duplicateText.split(/\r?\n/);
  const duplicateLine = duplicateLines.findIndex((value) => value.includes('Call SharedEntry'));
  const duplicateCharacter = duplicateLines[duplicateLine].indexOf('SharedEntry') + 2;
  const ambiguous = handlePrepareRename(
    { textDocument: { uri: duplicateDocument.uri }, position: { line: duplicateLine, character: duplicateCharacter } },
    documentsFor(duplicateDocument),
    projectIndexer.getIndex(),
  );
  assert.equal(ambiguous, null);
});

test('workspace symbols omit local scope and unresolved routines offer a stub action', () => {
  const { index } = sampleIndex();
  const symbols = handleWorkspaceSymbol({ query: 'localCounter' }, index);
  assert.deepEqual(symbols, []);
  const sharedSymbols = handleWorkspaceSymbol({ query: 'SharedValue' }, index);
  assert.equal(sharedSymbols.length, 1);
  assert.equal(sharedSymbols[0].name, 'SharedValue (Get)');

  const rootDir = path.resolve(__dirname, 'fixtures', 'code-actions-workspace');
  const sourceDir = path.join(rootDir, 'source');
  const filePath = path.join(sourceDir, 'modMissingRoutine.bas');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();
  const diagnostics = computeDiagnostics(filePath, indexer.getIndex());
  const unresolved = diagnostics.find((diagnostic) => diagnostic.message === "Unresolved routine 'MissingRoutine'");
  assert.ok(unresolved);
  const uri = pathToFileURL(filePath).href;
  const actions = handleCodeActions({
    textDocument: { uri },
    range: unresolved.range,
    context: { diagnostics: [unresolved] },
  });
  assert.ok(actions.some((action) => action.title === "Create stub routine 'MissingRoutine'"));
});

test('workspace symbols surface duplicate public definitions instead of picking one silently', () => {
  const projectRoot = path.resolve(__dirname, 'fixtures', 'project-scope-workspace');
  const sourceDirs = [
    path.join(projectRoot, 'AppA', 'source'),
    path.join(projectRoot, 'AppB', 'source'),
    path.join(projectRoot, 'AppC', 'source'),
  ];
  const indexer = new VB6Indexer(projectRoot, sourceDirs);
  indexer.buildFullIndex();

  const symbols = handleWorkspaceSymbol({ query: 'SharedEntry' }, indexer.getIndex());
  assert.equal(symbols.length, 2);
  assert.ok(symbols.every((symbol) => symbol.name === 'SharedEntry'));
  const locations = symbols.map((symbol) => fileURLToPath(symbol.location.uri).toLowerCase());
  assert.deepEqual(locations.sort(), [
    path.join(projectRoot, 'AppA', 'source', 'modShared.bas'),
    path.join(projectRoot, 'AppB', 'source', 'modShared.bas'),
  ].map((filePath) => filePath.toLowerCase()).sort());
});
