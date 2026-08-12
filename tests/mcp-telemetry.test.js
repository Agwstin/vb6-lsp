const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('MCP telemetry writes local opt-in usage logs without sensitive payload content', async () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'advanced-workspace');
  const telemetryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb6-lsp-telemetry-'));
  const serverScript = path.resolve(__dirname, '..', 'out', 'mcp', 'mcp', 'server.js');
  const child = spawn('node', [serverScript], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      VB6_LSP_ROOT: rootDir,
      VB6_LSP_PROJECT_FILES: path.join(rootDir, 'App', 'Advanced.vbp'),
      VB6_LSP_TELEMETRY_ENABLED: 'true',
      VB6_LSP_TELEMETRY_DIR: telemetryDir,
      VB6_LSP_TELEMETRY_CAPTURE_INPUTS: '0',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  function send(message) {
    child.stdin.write(JSON.stringify(message) + '\n');
  }

  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'index_stats', arguments: {} } });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'find_symbol', arguments: { name: 'ProcessOrder' } } });
  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_function', arguments: { file: 'missing.bas', name: 'Nope' } } });

  await new Promise((resolve) => setTimeout(resolve, 800));
  child.kill();

  const logPath = path.join(telemetryDir, 'mcp-usage.jsonl');
  assert.ok(fs.existsSync(logPath));

  const lines = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/);
  assert.ok(lines.length >= 3);

  const event = JSON.parse(lines[0]);
  const findSymbolEvent = lines.map((line) => JSON.parse(line)).find((entry) => entry.tool_name === 'find_symbol');
  const readFunctionErrorEvent = lines.map((line) => JSON.parse(line)).find((entry) => entry.tool_name === 'read_function');

  assert.equal(event.schema_version, 4);
  assert.equal(typeof event.server_version, 'string');
  assert.equal(typeof event.session_id, 'string');
  assert.equal(typeof event.request_id, 'string');
  assert.equal(typeof event.tool_name, 'string');
  assert.equal(typeof event.duration_ms, 'number');
  assert.equal(typeof event.output_chars, 'number');
  assert.equal(typeof event.workspace_id, 'string');
  assert.match(event.index_cache, /^(hit|miss|na)$/);
  assert.match(event.derived_cache, /^(hit|miss|na)$/);
  assert.match(event.result_count_state, /^(measured|na|unknown)$/);
  assert.ok(Array.isArray(event.input_summary.arg_keys));
  assert.ok(!('prompt' in event));
  assert.ok(!('content' in event));

  assert.equal(findSymbolEvent.result_count_state, 'measured');
  assert.equal(typeof findSymbolEvent.result_count, 'number');
  assert.equal(findSymbolEvent.input_summary.name_length, 'ProcessOrder'.length);

  assert.equal(readFunctionErrorEvent.result_count, null);
  assert.equal(readFunctionErrorEvent.result_count_state, 'na');
  assert.equal(typeof readFunctionErrorEvent.error, 'string');
  assert.equal(readFunctionErrorEvent.error_kind, 'not_found');

  // Privacy default: raw inputs are NOT captured unless explicitly opted in.
  for (const line of lines) {
    assert.ok(!('input_raw' in JSON.parse(line)));
  }
});

test('MCP telemetry captures raw inputs on misses only when explicitly enabled', async () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'advanced-workspace');
  const telemetryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb6-lsp-telemetry-raw-'));
  const serverScript = path.resolve(__dirname, '..', 'out', 'mcp', 'mcp', 'server.js');
  const child = spawn('node', [serverScript], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      VB6_LSP_ROOT: rootDir,
      VB6_LSP_PROJECT_FILES: path.join(rootDir, 'App', 'Advanced.vbp'),
      VB6_LSP_TELEMETRY_ENABLED: 'true',
      VB6_LSP_TELEMETRY_DIR: telemetryDir,
      VB6_LSP_TELEMETRY_CAPTURE_INPUTS: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  function send(message) {
    child.stdin.write(JSON.stringify(message) + '\n');
  }

  const longQuery = 'zz_'.repeat(80); // 240 chars, above the 160 cap

  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_code', arguments: { query: 'zzz_no_such_thing_anywhere' } } });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'find_symbol', arguments: { name: 'ProcessOrder' } } });
  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_function', arguments: { file: 'missing.bas', name: 'Nope' } } });
  send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'search_code', arguments: { query: longQuery } } });

  await new Promise((resolve) => setTimeout(resolve, 1200));
  child.kill();

  const logPath = path.join(telemetryDir, 'mcp-usage.jsonl');
  assert.ok(fs.existsSync(logPath));
  const events = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));

  const missEvent = events.find((entry) => entry.tool_name === 'search_code' && entry.input_raw?.query === 'zzz_no_such_thing_anywhere');
  assert.ok(missEvent, 'search_code miss event with raw query missing');
  assert.equal(missEvent.result_count, 0);

  // Successful calls never carry raw inputs, even in capture mode.
  const hitEvent = events.find((entry) => entry.tool_name === 'find_symbol');
  assert.ok(hitEvent, 'find_symbol event missing');
  assert.ok(!('input_raw' in hitEvent));

  // Tool ERRORS also capture raw inputs (that is what failure diagnosis needs).
  const errorEvent = events.find((entry) => entry.tool_name === 'read_function');
  assert.ok(errorEvent, 'read_function event missing');
  assert.equal(typeof errorEvent.error, 'string');
  assert.equal(errorEvent.input_raw.file, 'missing.bas');
  assert.equal(errorEvent.input_raw.name, 'Nope');

  // Raw inputs are truncated to the cap.
  const truncatedEvent = events.find((entry) => entry.tool_name === 'search_code' && entry.input_raw?.query?.startsWith('zz_zz_'));
  assert.ok(truncatedEvent, 'long-query miss event missing');
  assert.equal(truncatedEvent.input_raw.query.length, 160);
});
