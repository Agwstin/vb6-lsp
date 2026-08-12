const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fileURLToPath, pathToFileURL } = require('node:url');

function sameFileUri(uri, filePath) {
  try {
    return path.normalize(fileURLToPath(uri)).toLowerCase() === path.normalize(filePath).toLowerCase();
  } catch {
    return false;
  }
}

function editsForFile(changes, filePath) {
  const entry = Object.entries(changes || {}).find(([uri]) => sameFileUri(uri, filePath));
  return entry ? entry[1] : [];
}

test('LSP treats an unsaved VB6 buffer as authoritative across navigation features', async () => {
  const serverCwd = path.resolve(__dirname, '..');
  const serverScript = path.join(serverCwd, 'out', 'server', 'server.js');
  const rootPath = path.resolve(__dirname, 'fixtures', 'sample-workspace');
  const filePath = path.join(rootPath, 'Client', 'source', 'modSample.bas');
  const fileUri = pathToFileURL(filePath).href;
  const originalText = fs.readFileSync(filePath, 'latin1');
  const child = spawn('node', [serverScript, '--stdio'], {
    cwd: serverCwd,
    env: { ...process.env, VB6_LSP_TELEMETRY_ENABLED: 'false' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = Buffer.alloc(0);
  let nextId = 1;
  let stderr = '';
  const pending = new Map();
  const notifications = [];
  const notificationWaiters = [];

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

  function dispatchNotification(message) {
    notifications.push(message);
    for (let i = notificationWaiters.length - 1; i >= 0; i--) {
      const waiter = notificationWaiters[i];
      if (!waiter.predicate(message)) continue;
      notificationWaiters.splice(i, 1);
      waiter.resolve(message);
    }
  }

  function waitForNotification(predicate, timeoutMs = 5000, label = 'notification') {
    const existing = notifications.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      let entry;
      const timer = setTimeout(() => {
        const index = notificationWaiters.indexOf(entry);
        if (index >= 0) notificationWaiters.splice(index, 1);
        reject(new Error(`Timed out waiting for ${label}; seen=${notifications.map((message) => message.method).join(',')}; stderr=${stderr}`));
      }, timeoutMs);
      entry = {
        predicate,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      };
      notificationWaiters.push(entry);
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
        dispatchNotification(message);
      }
    }
  }

  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    parseMessages();
  });

  function decodedTokenLines(data) {
    const lines = [];
    let line = 0;
    let start = 0;
    for (let index = 0; index < data.length; index += 5) {
      line += data[index];
      start = data[index] === 0 ? start + data[index + 1] : data[index + 1];
      lines.push({ line, start, length: data[index + 2] });
    }
    return lines;
  }

  const modifiedText = [
    originalText.trimEnd(),
    'Public Sub UnsavedRoutine()',
    'End Sub',
    'Public Sub UnsavedBroken()',
  ].join('\r\n') + '\r\n';
  const unsavedRoutineLine = modifiedText.split(/\r?\n/).findIndex((line) => line.includes('UnsavedRoutine'));
  const brokenRoutineLine = modifiedText.split(/\r?\n/).findIndex((line) => line.includes('UnsavedBroken'));
  const useSharedLine = modifiedText.split(/\r?\n/).findIndex((line) => /Call\s+UseShared/i.test(line));
  const useSharedCharacter = modifiedText.split(/\r?\n/)[useSharedLine].indexOf('UseShared') + 2;

  try {
    await request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(rootPath).href,
      clientInfo: { name: 'node-unsaved-buffer-test', version: '1.0.0' },
      capabilities: {},
    });
    send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    await waitForNotification((message) => message.method === 'vb6/indexing' && message.params?.status === 'done', 5000, 'indexing');

    const openedText = [
      originalText.trimEnd(),
      'Public Sub OpenOnlyRoutine()',
      'End Sub',
    ].join('\r\n') + '\r\n';
    send({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: fileUri,
          languageId: 'vb6',
          version: 1,
          text: openedText,
        },
      },
    });

    const openOnlySymbols = await request('workspace/symbol', { query: 'OpenOnlyRoutine' });
    assert.equal(openOnlySymbols.length, 1, 'didOpen content must enter the workspace index before didChange');

    send({
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri: fileUri, version: 2 },
        contentChanges: [{ text: modifiedText }],
      },
    });

    const workspaceSymbols = await request('workspace/symbol', { query: 'UnsavedRoutine' });
    assert.equal(workspaceSymbols.length, 1, 'unsaved declarations must enter the workspace index');
    assert.equal(workspaceSymbols[0].name, 'UnsavedRoutine');

    const unsavedDiagnosticsMessage = await waitForNotification(
      (message) => message.method === 'textDocument/publishDiagnostics' &&
        message.params?.uri === fileUri &&
        message.params.diagnostics.some((diagnostic) => diagnostic.message === "Missing End Sub for 'UnsavedBroken'"),
      5000,
      'unsaved diagnostics',
    );
    const unsavedDiagnostic = unsavedDiagnosticsMessage.params.diagnostics.find((diagnostic) =>
      diagnostic.message === "Missing End Sub for 'UnsavedBroken'",
    );

    const semanticTokens = await request('textDocument/semanticTokens/full', { textDocument: { uri: fileUri } });
    assert.ok(decodedTokenLines(semanticTokens.data).some((token) => token.line === unsavedRoutineLine));

    const references = await request('textDocument/references', {
      textDocument: { uri: fileUri },
      position: { line: useSharedLine, character: useSharedCharacter },
      context: { includeDeclaration: false },
    });
    assert.ok(references.some((location) => sameFileUri(location.uri, filePath) && location.range.start.line === useSharedLine));

    const rename = await request('textDocument/rename', {
      textDocument: { uri: fileUri },
      position: { line: useSharedLine, character: useSharedCharacter },
      newName: 'RenamedShared',
    });
    const renameEdits = editsForFile(rename.changes, filePath);
    assert.ok(renameEdits.some((edit) => edit.range.start.line === useSharedLine));

    const codeActions = await request('textDocument/codeAction', {
      textDocument: { uri: fileUri },
      range: unsavedDiagnostic.range,
      context: { diagnostics: [unsavedDiagnostic] },
    });
    const addEndAction = codeActions.find((action) => action.title === 'Add End Sub');
    assert.ok(addEndAction);
    const codeActionEdits = editsForFile(addEndAction.edit.changes, filePath);
    assert.equal(codeActionEdits[0].range.start.line, modifiedText.split(/\r?\n/).length);

    const diagnostics = notifications
      .filter((message) => message.method === 'textDocument/publishDiagnostics' && message.params?.uri === fileUri)
      .flatMap((message) => message.params.diagnostics);
    assert.ok(diagnostics.some((diagnostic) => diagnostic.range.start.line === brokenRoutineLine));

    send({ jsonrpc: '2.0', method: 'textDocument/didClose', params: { textDocument: { uri: fileUri } } });
    const converged = await request('workspace/symbol', { query: 'UnsavedRoutine' });
    assert.deepEqual(converged, [], 'closing the document must restore disk-backed index state');
  } finally {
    try {
      await request('shutdown', null);
    } catch {}
    send({ jsonrpc: '2.0', method: 'exit', params: {} });
    child.kill();
  }
});
