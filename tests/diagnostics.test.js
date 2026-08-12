const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { VB6Indexer } = require('../out/server/indexer/indexer.js');
const { computeDiagnostics } = require('../out/server/providers/diagnostics.js');
const { resolveWorkspaceConfig } = require('../out/server/config.js');

test('unresolved routine diagnostics ignore enum members and type fields', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'code-actions-workspace');
  const sourceDir = path.join(rootDir, 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();

  const filePath = path.join(sourceDir, 'modEnumDiagnostics.bas');
  const diagnostics = computeDiagnostics(filePath, indexer.getIndex());
  const messages = diagnostics.map((diagnostic) => diagnostic.message);

  assert.ok(messages.includes("Unresolved routine 'MissingRoutine'"));
  assert.ok(!messages.includes("Unresolved routine 'Shout_Chat_Message'"));
  assert.ok(!messages.includes("Unresolved routine 'Private_Chat_Message'"));
  assert.ok(!messages.includes("Unresolved routine 'E_PUEDE'"));
  assert.ok(!messages.includes("Unresolved routine 'E_DUELO_PUEDE'"));
  assert.ok(!messages.includes("Unresolved routine 'Name'"));
});

test('duplicate public diagnostics ignore same-named class members', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'code-actions-workspace');
  const sourceDir = path.join(rootDir, 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();

  const filePath = path.join(sourceDir, 'clsDuplicateMemberA.cls');
  const diagnostics = computeDiagnostics(filePath, indexer.getIndex());

  assert.ok(!diagnostics.some((diagnostic) => diagnostic.message.includes("Duplicate Public symbol 'Connect'")));
});

test('With receiver diagnostics accept project form components', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'advanced-workspace');
  const sourceDir = path.join(rootDir, 'App', 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();
  const config = resolveWorkspaceConfig({
    rootUri: `file:///${rootDir.replace(/\\/g, '/')}`,
    settings: {},
  });

  const filePath = path.join(sourceDir, 'modFormWith.bas');
  const diagnostics = computeDiagnostics(filePath, indexer.getIndex(), config);

  assert.ok(!diagnostics.some((diagnostic) => diagnostic.message.includes("Unresolved With receiver 'frmMain'")));
});

test('form diagnostics ignore designer properties and accept controls as With receivers', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'advanced-workspace');
  const sourceDir = path.join(rootDir, 'App', 'source');
  const indexer = new VB6Indexer(rootDir, [sourceDir]);
  indexer.buildFullIndex();
  const config = resolveWorkspaceConfig({
    rootUri: `file:///${rootDir.replace(/\\/g, '/')}`,
    settings: {},
  });

  const filePath = path.join(sourceDir, 'frmMain.frm');
  const diagnostics = computeDiagnostics(filePath, indexer.getIndex(), config);

  assert.ok(!diagnostics.some((diagnostic) => diagnostic.message.includes("Unresolved routine 'EndProperty'")));
  assert.ok(!diagnostics.some((diagnostic) => diagnostic.message.includes("Unresolved With receiver 'cmdAccept'")));
});

test('duplicate public diagnostics are scoped to the owning VB6 project', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'project-scope-workspace');
  const config = resolveWorkspaceConfig({
    rootUri: `file:///${rootDir.replace(/\\/g, '/')}`,
    settings: {},
  });
  const indexer = new VB6Indexer(rootDir, config.sourceDirs);
  indexer.buildFullIndex();

  const appAFile = path.join(rootDir, 'AppA', 'source', 'modShared.bas');
  const appBFile = path.join(rootDir, 'AppB', 'source', 'modShared.bas');
  const appADiagnostics = computeDiagnostics(appAFile, indexer.getIndex(), config);
  const appBDiagnostics = computeDiagnostics(appBFile, indexer.getIndex(), config);

  assert.ok(!appADiagnostics.some((diagnostic) => diagnostic.message.includes("Duplicate Public symbol 'SharedEntry'")));
  assert.ok(!appBDiagnostics.some((diagnostic) => diagnostic.message.includes("Duplicate Public symbol 'SharedEntry'")));
  assert.ok(appADiagnostics.some((diagnostic) => diagnostic.message.includes("Duplicate Public symbol 'E_SHARED_STATUS'")));
});
