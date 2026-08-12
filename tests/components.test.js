const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { resolveWorkspaceConfig } = require('../out/server/config.js');
const { VB6Indexer } = require('../out/server/indexer/indexer.js');
const { buildVB6Index } = require('../out/server/indexer/mcp-bridge.js');

const fixtureRoot = path.resolve(__dirname, 'fixtures', 'component-workspace');

test('component policy indexes UserControls and reports Designers as unsupported', () => {
  const config = resolveWorkspaceConfig({
    rootUri: pathToFileURL(fixtureRoot).href,
    settings: {},
  });
  const components = config.projects[0].components;
  const userControl = components.find((component) => component.kind === 'UserControl');
  const designer = components.find((component) => component.kind === 'Designer');

  assert.ok(userControl);
  assert.equal(userControl.supported, true);
  assert.match(userControl.path, /ucWidget\.ctl$/i);
  assert.ok(designer);
  assert.equal(designer.supported, false);
  assert.match(designer.limitation, /not indexed|unsupported/i);

  const indexer = new VB6Indexer(fixtureRoot, config.sourceDirs);
  indexer.buildFullIndex();
  const index = indexer.getIndex();
  const normalizedSuffix = (value) => value.replace(/\\/g, '/').toLowerCase();
  assert.ok([...index.files].some((file) => normalizedSuffix(file).endsWith('/ucwidget.ctl')));
  assert.ok(![...index.files].some((file) => normalizedSuffix(file).endsWith('/designeronly.dsr')));
  assert.ok((index.byName.get('ping') || []).some((symbol) => normalizedSuffix(symbol.file).endsWith('/ucwidget.ctl')));
});

test('MCP collection includes supported .ctl source files', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vb6-lsp-component-mcp-'));
  try {
    fs.cpSync(fixtureRoot, tempRoot, { recursive: true });
    const sourceDir = path.join(tempRoot, 'App', 'source');
    const index = buildVB6Index(tempRoot, [sourceDir]);
    assert.ok(index.files.some((file) => file.name.toLowerCase() === 'ucwidget.ctl'));
    assert.ok(index.symbols.some((symbol) => symbol.name === 'Ping' && symbol.file.toLowerCase().endsWith('ucwidget.ctl')));
    assert.ok(!index.files.some((file) => file.name.toLowerCase() === 'designeronly.dsr'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
