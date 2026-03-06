const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('advanced MCP tools expose project/reference/type metadata', async () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'advanced-workspace');
  const serverScript = path.resolve(__dirname, '..', 'out', 'mcp', 'mcp', 'server.js');
  const child = spawn('node', [serverScript], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      VB6_LSP_ROOT: rootDir,
      VB6_LSP_PROJECT_FILES: path.join(rootDir, 'App', 'Advanced.vbp'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
  });

  function encode(message) {
    return JSON.stringify(message) + '\n';
  }

  child.stdin.write(encode({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } }));
  child.stdin.write(encode({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }));
  child.stdin.write(encode({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_projects', arguments: {} } }));
  child.stdin.write(encode({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'reference_info', arguments: { query: 'OLE' } } }));
  child.stdin.write(encode({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'type_members', arguments: { typeName: 'clsWorker' } } }));

  await new Promise((resolve) => setTimeout(resolve, 600));
  child.kill();

  assert.match(stdout, /AdvancedApp/);
  assert.match(stdout, /OLE Automation/);
  assert.match(stdout, /CreateWorker|DisplayName|ProcessOrder/);
});
