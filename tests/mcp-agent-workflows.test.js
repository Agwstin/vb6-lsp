const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('agent workflow MCP tools expose packet handler and UI analysis', async () => {
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
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'summarize_module', arguments: { file: 'frmMain.frm' } } });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'analyze_packet_handler', arguments: { name: 'HandlePacket' } } });
  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'analyze_ui_form', arguments: { file: 'frmMain.frm' } } });

  await new Promise((resolve) => setTimeout(resolve, 800));
  child.kill();

  assert.match(stdout, /ui-form/);
  assert.match(stdout, /packet-handler/);
  assert.match(stdout, /cmdAccept/);
  assert.match(stdout, /HandlePacket/);
});
