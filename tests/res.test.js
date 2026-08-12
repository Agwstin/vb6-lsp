const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');

function loadResModule() {
  const built = path.join(repoRoot, 'out', 'mcp', 'mcp', 'res.js');
  if (fs.existsSync(built)) return require(built);
  const ts = require('typescript');
  const sourcePath = path.join(repoRoot, 'src', 'mcp', 'res.ts');
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

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function ordinal(value) {
  return Buffer.concat([u16(0xffff), u16(value)]);
}

function makeNullResourceHeader() {
  const fixed = Buffer.concat([u32(0), u16(0), u16(0), u32(0), u32(0)]);
  return Buffer.concat([u32(0), u32(32), ordinal(0), ordinal(0), fixed]);
}

function makeStringTable(values = ['Hello', 'World']) {
  const parts = [];
  for (let index = 0; index < 16; index += 1) {
    const value = values[index] || '';
    const bytes = Buffer.from(value, 'utf16le');
    parts.push(u16(value.length), bytes);
  }
  return Buffer.concat(parts);
}

function makeResStringTable(values) {
  const data = makeStringTable(values);
  return makeResResource(data);
}

function makeResResource(data, typeId = 6, nameId = 1) {
  const type = ordinal(typeId);
  const name = ordinal(nameId);
  const fixed = Buffer.concat([u32(0), u16(0), u16(0x0409), u32(1), u32(0)]);
  const headerSize = 8 + type.length + name.length + fixed.length;
  const header = Buffer.concat([u32(data.length), u32(headerSize), type, name, fixed]);
  const padding = Buffer.alloc((4 - ((header.length + data.length) % 4)) % 4);
  return Buffer.concat([header, data, padding, Buffer.alloc(8)]);
}

test('RES parser reads aligned standard records and RT_STRING values', () => {
  const res = loadResModule();
  const bytes = makeResStringTable(['Hello', 'World']);
  const parsed = res.parseResBuffer(bytes, { previewBytes: 4 });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entryCount, 1);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].typeLabel, 'STRING');
  assert.deepEqual(parsed.entries[0].name, { kind: 'ordinal', value: 1 });
  assert.equal(parsed.entries[0].dataPreviewHex, '05004800');
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.entries[0], 'data'), false);
  assert.equal(parsed.stringTableTruncated, false);
  assert.deepEqual(parsed.stringTable, [
    { id: 0, value: 'Hello', block: 1, index: 0, truncated: false },
    { id: 1, value: 'World', block: 1, index: 1, truncated: false },
  ]);
});

test('RES parser skips the standard null header and keeps block IDs zero-based', () => {
  const res = loadResModule();
  const bytes = Buffer.concat([makeNullResourceHeader(), makeResStringTable(['First'])]);
  const parsed = res.parseResBuffer(bytes);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entryCount, 1);
  assert.equal(parsed.entries[0].typeLabel, 'STRING');
  assert.deepEqual(parsed.stringTable[0], { id: 0, value: 'First', block: 1, index: 0, truncated: false });
});

test('RES parser reports when an oversized RT_STRING table is intentionally not decoded', () => {
  const res = loadResModule();
  const oversized = Buffer.alloc(res.MAX_STRING_TABLE_BYTES + 1);
  const parsed = res.parseResBuffer(makeResResource(oversized));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entryCount, 1);
  assert.deepEqual(parsed.stringTable, []);
  assert.equal(parsed.stringTableTruncated, true);
});

test('RES inspection rejects malformed records and workspace escapes', () => {
  const res = loadResModule();
  const malformed = Buffer.concat([u32(99), u32(8), Buffer.alloc(8)]);
  const parsed = res.parseResBuffer(malformed);
  assert.equal(parsed.ok, false);
  assert.match(parsed.message, /resource id|truncated/i);

  const oversized = res.parseResBuffer({ length: res.MAX_RES_FILE_BYTES + 1 });
  assert.equal(oversized.ok, false);
  assert.match(oversized.message, /safety limit/i);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb6-lsp-res-'));
  try {
    fs.writeFileSync(path.join(root, 'Strings.res'), makeResStringTable(['Safe']));
    const inspected = res.inspectResFile(root, 'Strings.res');
    assert.equal(inspected.ok, true);
    assert.equal(inspected.file, 'Strings.res');
    assert.equal(inspected.stringTable[0].value, 'Safe');

    const escaped = res.inspectResFile(root, '..\\outside.res');
    assert.equal(escaped.ok, false);
    assert.equal(escaped.errorKind, 'invalid_args');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MCP exposes inspect_res after the generated MCP output is built', { skip: !fs.existsSync(path.join(repoRoot, 'out', 'mcp', 'mcp', 'res.js')) }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb6-lsp-res-mcp-'));
  try {
    fs.writeFileSync(path.join(root, 'Strings.res'), makeResStringTable(['From MCP']));
    const serverScript = path.join(repoRoot, 'out', 'mcp', 'mcp', 'server.js');
    const child = spawn(process.execPath, [serverScript], {
      cwd: repoRoot,
      env: { ...process.env, VB6_LSP_ROOT: root, VB6_LSP_TELEMETRY_ENABLED: '0' },
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
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'inspect_res', arguments: { file: 'Strings.res' } } });
    await new Promise((resolve) => setTimeout(resolve, 500));
    child.kill();
    assert.equal(stderr.includes('Unhandled'), false, stderr);
    const messages = buffer.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    const tools = messages.find((message) => message.id === 2).result.tools;
    assert.ok(tools.some((tool) => tool.name === 'inspect_res'));
    const response = messages.find((message) => message.id === 3);
    assert.equal(response.result.isError, undefined);
    const payload = JSON.parse(response.result.content[0].text);
    assert.equal(payload.inspection.file, 'Strings.res');
    assert.equal(payload.inspection.stringTable[0].value, 'From MCP');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
