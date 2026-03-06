const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

test('LSP indexes a .vbp workspace and resolves definition/references', async () => {
  const serverCwd = path.resolve(__dirname, '..');
  const serverScript = path.join(serverCwd, 'out', 'server', 'server.js');
  const rootPath = path.resolve(__dirname, 'fixtures', 'sample-workspace');
  const testFile = path.join(rootPath, 'Client', 'source', 'modSample.bas');
  const child = spawn('node', [serverScript, '--stdio'], {
    cwd: serverCwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();
  const notifications = [];
  let stderr = '';

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  function encode(message) {
    const json = JSON.stringify(message);
    return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
  }

  function send(message) {
    child.stdin.write(encode(message));
  }

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ jsonrpc: '2.0', id, method, params });
    });
  }

  function parseMessages() {
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const header = buffer.slice(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      assert.ok(match, 'Missing Content-Length');

      const contentLength = Number(match[1]);
      const messageEnd = headerEnd + 4 + contentLength;
      if (buffer.length < messageEnd) return;

      const body = buffer.slice(headerEnd + 4, messageEnd).toString('utf8');
      buffer = buffer.slice(messageEnd);
      const message = JSON.parse(body);

      if (typeof message.id !== 'undefined') {
        const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
        else waiter.resolve(message.result);
      } else {
        notifications.push(message);
      }
    }
  }

  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    parseMessages();
  });

  async function waitForIndex() {
    const started = Date.now();
    while (Date.now() - started < 5000) {
      const done = notifications.find((message) => message.method === 'vb6/indexing' && message.params?.status === 'done');
      if (done) return done.params;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for index. stderr=${stderr}`);
  }

  try {
    await request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(rootPath).href,
      clientInfo: { name: 'node-test', version: '1.0.0' },
      capabilities: {},
    });
    send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    send({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: pathToFileURL(testFile).href,
          languageId: 'vb6',
          version: 1,
          text: require('node:fs').readFileSync(testFile, 'latin1'),
        },
      },
    });
    send({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: pathToFileURL(path.join(rootPath, 'Common', 'modShared.bas')).href,
          languageId: 'vb6',
          version: 1,
          text: require('node:fs').readFileSync(path.join(rootPath, 'Common', 'modShared.bas'), 'latin1'),
        },
      },
    });

    const indexing = await waitForIndex();
    assert.equal(indexing.fileCount, 2);

    const workspaceSymbols = await request('workspace/symbol', { query: 'SharedValue' });
    assert.ok(Array.isArray(workspaceSymbols));
    assert.equal(workspaceSymbols.length, 1);

    const definition = await request('textDocument/definition', {
      textDocument: { uri: pathToFileURL(testFile).href },
      position: { line: 6, character: 10 },
    });
    assert.ok(Array.isArray(definition));
    assert.equal(definition.length, 1);
    assert.ok(definition[0].uri.includes('modShared.bas'));

    const references = await request('textDocument/references', {
      textDocument: { uri: pathToFileURL(path.join(rootPath, 'Common', 'modShared.bas')).href },
      position: { line: 10, character: 10 },
      context: { includeDeclaration: false },
    });
    assert.ok(Array.isArray(references));
    assert.ok(references.length >= 1);
  } finally {
    try {
      await request('shutdown', null);
    } catch {}
    send({ jsonrpc: '2.0', method: 'exit', params: {} });
    child.kill();
  }
});
