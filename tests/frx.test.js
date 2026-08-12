const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.resolve(__dirname, 'fixtures', 'frx-workspace');
const sourceFile = path.join(fixtureRoot, 'Form1.frm');

function loadFrxModule() {
  const built = path.join(repoRoot, 'out', 'mcp', 'mcp', 'frx.js');
  if (fs.existsSync(built)) return require(built);

  // The repository deliberately keeps TypeScript sources and generated out/
  // separate. This lets the focused parser test run before a full package
  // build without writing generated files into the worktree.
  const ts = require('typescript');
  const sourcePath = path.join(repoRoot, 'src', 'mcp', 'frx.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  }).outputText;
  const loaded = new Module(sourcePath, module);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(repoRoot);
  loaded._compile(transpiled, sourcePath);
  return loaded.exports;
}

test('FRX references resolve a bounded short-string companion record', () => {
  const frx = loadFrxModule();
  assert.deepEqual(frx.parseFrxReference('  $"Form1.frx":0BCA trailing'), {
    file: 'Form1.frx',
    offset: 0x0BCA,
    dollar: true,
  });
  assert.equal(frx.parseFrxReference('"Form1.res":0000'), null);
  assert.equal(frx.kindForFrxProperty('Controls.Caption(0)', false), 'string_short');

  const result = frx.inspectFrxReference(fixtureRoot, sourceFile, '"Form1.frx":0000', {
    property: 'Caption',
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'decoded');
  assert.equal(result.companionFile, 'Form1.frx');
  assert.equal(result.value.type, 'text');
  assert.equal(result.value.text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?');
  assert.equal(result.value.byteLength, 65);

  const cp1252 = frx.decodeFrxValue(Buffer.from([3, 0x80, 0x93, 0x94]), 0, 'string_short');
  assert.equal(cp1252.ok, true);
  assert.equal(cp1252.value.text, '€“”');

  const medium = frx.decodeFrxValue(Buffer.from([0xff, 4, 0, 0x56, 0x42, 0x36, 0x00]), 0, 'string_medium');
  assert.equal(medium.ok, true);
  assert.equal(medium.value.text, 'VB6\0');
  assert.equal(medium.value.byteLength, 7);

  const mediumOffByOne = frx.decodeFrxValue(Buffer.from([0xff, 5, 0, 0x56, 0x42, 0x36, 0x00]), 0, 'string_medium');
  assert.equal(mediumOffByOne.ok, true);
  assert.equal(mediumOffByOne.value.text, 'VB6\0');
  assert.equal(mediumOffByOne.value.lengthAdjusted, true);
  assert.equal(mediumOffByOne.value.declaredByteLength, 8);

  const temporaryRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'vb6-frx-medium-'));
  try {
    const temporarySource = path.join(temporaryRoot, 'Form.frm');
    const temporaryCompanion = path.join(temporaryRoot, 'Form.frx');
    fs.writeFileSync(temporarySource, 'Caption = "Form.frx":0000\r\n');
    fs.writeFileSync(temporaryCompanion, Buffer.from([0xff, 3, 0, 0x56, 0x42, 0x36]));
    const inferred = frx.inspectFrxReference(temporaryRoot, temporarySource, '"Form.frx":0000', { property: 'Caption' });
    assert.equal(inferred.ok, true);
    assert.equal(inferred.kind, 'string_medium');
    assert.equal(inferred.value.text, 'VB6');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }

  const escaped = frx.inspectFrxReference(fixtureRoot, sourceFile, '"..\\outside.frx":0000', { kind: 'opaque' });
  assert.equal(escaped.ok, false);
  assert.equal(escaped.errorKind, 'invalid_args');
});

test('FRX standard picture metadata and malformed records are bounded', () => {
  const frx = loadFrxModule();
  const picture = Buffer.concat([
    Buffer.from([12, 0, 0, 0]),
    Buffer.from('lt\0\0', 'latin1'),
    Buffer.from([4, 0, 0, 0]),
    Buffer.from([0x42, 0x4d, 0x00, 0x00]),
  ]);
  const decoded = frx.decodeFrxValue(picture, 0, 'picture', 2);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.value, {
    type: 'picture',
    format: 'bmp',
    dataByteLength: 4,
    byteLength: 16,
    previewHex: '424d',
  });

  const truncated = frx.decodeFrxValue(Uint8Array.from([64, 65]), 0, 'string_short');
  assert.equal(truncated.ok, false);
  assert.match(truncated.message, /truncated/i);
  const outOfRange = frx.decodeFrxValue(Uint8Array.from([0, 0]), 99, 'opaque');
  assert.equal(outOfRange.ok, false);

  const oversized = frx.decodeFrxValue({ length: frx.MAX_FRX_FILE_BYTES + 1 }, 0, 'opaque');
  assert.equal(oversized.ok, false);
  assert.match(oversized.message, /safety limit/i);
});

test('MCP exposes inspect_frx after the generated MCP output is built', { skip: !fs.existsSync(path.join(repoRoot, 'out', 'mcp', 'mcp', 'frx.js')) }, async () => {
  const serverScript = path.join(repoRoot, 'out', 'mcp', 'mcp', 'server.js');
  const child = spawn(process.execPath, [serverScript], {
    cwd: repoRoot,
    env: { ...process.env, VB6_LSP_ROOT: fixtureRoot, VB6_LSP_SOURCE_DIRS: fixtureRoot },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let buffer = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
    name: 'inspect_frx',
    arguments: { file: 'Form1.frm', value: '"Form1.frx":0000', property: 'Caption' },
  } });
  await new Promise((resolve) => setTimeout(resolve, 500));
  child.kill();
  assert.equal(stderr.includes('Unhandled'), false, stderr);
  const messages = buffer.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const tools = messages.find((message) => message.id === 2).result.tools;
  assert.ok(tools.some((tool) => tool.name === 'inspect_frx'));
  const response = messages.find((message) => message.id === 3);
  assert.equal(response.result.isError, undefined);
  const payload = JSON.parse(response.result.content[0].text);
  assert.equal(payload.inspection.status, 'decoded');
  assert.equal(payload.inspection.value.text.startsWith('ABC'), true);
});
