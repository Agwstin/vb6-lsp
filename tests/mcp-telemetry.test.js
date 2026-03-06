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

  await new Promise((resolve) => setTimeout(resolve, 800));
  child.kill();

  const logPath = path.join(telemetryDir, 'mcp-usage.jsonl');
  assert.ok(fs.existsSync(logPath));

  const lines = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/);
  assert.ok(lines.length >= 2);

  const event = JSON.parse(lines[0]);
  assert.equal(typeof event.tool_name, 'string');
  assert.equal(typeof event.duration_ms, 'number');
  assert.equal(typeof event.output_chars, 'number');
  assert.equal(typeof event.workspace_id, 'string');
  assert.ok(!('prompt' in event));
  assert.ok(!('content' in event));
});
