const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('agent-oriented MCP tools expose explanations, flow, mutations, and entrypoints', async () => {
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

  function send(message) {
    child.stdin.write(JSON.stringify(message) + '\n');
  }

  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'explain_symbol', arguments: { name: 'ProcessOrder' } } });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'find_callers', arguments: { name: 'ProcessOrder' } } });
  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'find_callees', arguments: { name: 'HandlePacket' } } });
  send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'trace_flow', arguments: { name: 'HandlePacket', maxDepth: 2 } } });
  send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'find_state_mutations', arguments: { name: 'worker' } } });
  send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'find_network_entrypoints', arguments: {} } });
  send({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'find_ui_entrypoints', arguments: {} } });
  send({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'find_related_symbols', arguments: { name: 'ProcessOrder' } } });

  await new Promise((resolve) => setTimeout(resolve, 800));
  child.kill();

  assert.match(stdout, /mostLikelyDefinition/);
  assert.match(stdout, /HandlePacket/);
  assert.match(stdout, /ProcessOrder/);
  assert.match(stdout, /mutations/);
  assert.match(stdout, /entrypoints/);
  assert.match(stdout, /related/);
});
