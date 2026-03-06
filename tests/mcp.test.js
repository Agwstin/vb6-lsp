const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('MCP server exposes tools and indexes a workspace from env configuration', async () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'sample-workspace');
  const serverScript = path.resolve(__dirname, '..', 'out', 'mcp', 'mcp', 'server.js');
  const child = spawn('node', [serverScript], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      VB6_LSP_ROOT: rootDir,
      VB6_LSP_PROJECT_FILES: path.join(rootDir, 'Client', 'TestClient.vbp'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  function encode(message) {
    const json = JSON.stringify(message);
    return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
  }

  child.stdin.write(encode({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } }));
  child.stdin.write(encode({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }));
  child.stdin.write(encode({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
  child.stdin.write(encode({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_function', arguments: { file: 'modShared.bas', name: 'UseShared' } } }));
  child.stdin.write(encode({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_symbols', arguments: { file: 'modShared.bas', kind: 'Sub' } } }));
  child.stdin.write(encode({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'index_stats', arguments: {} } }));

  await new Promise((resolve) => setTimeout(resolve, 500));
  child.kill();

  assert.match(stderr, /Indexed \d+ symbols/);
  assert.match(buffer, /index_stats|symbols|files/);
  assert.match(buffer, /TestClient\.vbp/);
  assert.match(buffer, /read_function/);
  assert.match(buffer, /list_symbols/);
  assert.match(buffer, /UseShared/);
});
