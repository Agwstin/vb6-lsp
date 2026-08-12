const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SERVER_SCRIPT = path.resolve(__dirname, '..', 'out', 'mcp', 'mcp', 'server.js');

// Response-driven harness: call() resolves when the matching response arrives,
// so tests never depend on fixed sleeps (no startup races, no flaky timeouts).
function startServer(env) {
  const child = spawn('node', [SERVER_SCRIPT], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  let stderr = '';
  const pending = new Map();
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        const resolve = pending.get(message.id);
        if (resolve) {
          pending.delete(message.id);
          resolve(message);
        }
      } catch { /* ignore */ }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  let idCounter = 0;
  function send(message) {
    child.stdin.write(JSON.stringify(message) + '\n');
  }
  send({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });

  return {
    child,
    call(tool, args, timeoutMs = 30000) {
      const id = ++idCounter;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`timeout waiting for ${tool} response (id ${id})`));
        }, timeoutMs);
        pending.set(id, (message) => {
          clearTimeout(timer);
          resolve(JSON.parse(message.result.content[0].text));
        });
        send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } });
      });
    },
    indexBuildCount() {
      return (stderr.match(/\[vb6-index\] Indexed /g) || []).length;
    },
    stop() {
      child.kill();
    },
  };
}

function sampleEnv() {
  const rootDir = path.resolve(__dirname, 'fixtures', 'sample-workspace');
  return {
    VB6_LSP_ROOT: rootDir,
    VB6_LSP_PROJECT_FILES: path.join(rootDir, 'Client', 'TestClient.vbp'),
  };
}

function projectScopeEnv(extra = {}) {
  const rootDir = path.resolve(__dirname, 'fixtures', 'project-scope-workspace');
  return {
    VB6_LSP_ROOT: rootDir,
    VB6_LSP_PROJECT_FILES: [
      path.join(rootDir, 'AppA', 'AppA.vbp'),
      path.join(rootDir, 'AppB', 'AppB.vbp'),
      path.join(rootDir, 'AppC', 'AppC.vbp'),
    ].join(';'),
    ...extra,
  };
}

test('argument aliases rescue calls that previously returned silent empties', async () => {
  const server = startServer(sampleEnv());
  try {
    const callers = await server.call('find_callers', { symbol: 'UseShared' });
    assert.ok(callers.callers.includes('demo'), `expected demo in callers, got ${JSON.stringify(callers.callers)}`);

    const symbol = await server.call('find_symbol', { symbol: 'UseShared', includeBody: false });
    assert.equal(symbol.count, 1);

    const search = await server.call('search_code', { text: 'UseShared', maxResults: 5 });
    assert.ok(search.count >= 1);

    const invalid = await server.call('find_callers', {});
    assert.equal(invalid.error_kind, 'invalid_args');
    assert.ok(Array.isArray(invalid.accepted_aliases));
  } finally {
    server.stop();
  }
});

test('Module.Proc names and call decoration are understood', async () => {
  const server = startServer(sampleEnv());
  try {
    const dotted = await server.call('read_function', { name: 'modShared.UseShared' });
    assert.equal(dotted.symbol.name, 'UseShared');
    assert.match(dotted.file, /modShared\.bas$/);

    const refs = await server.call('find_references', { name: 'UseShared()' });
    assert.ok(refs.count >= 1, 'parenthesized name should still find references');

    const noExtension = await server.call('read_function', { name: 'UseShared', file: 'modShared' });
    assert.equal(noExtension.symbol.name, 'UseShared');

    // A filename passed as name is an agent mistake — explicit error, not routine "bas".
    const filenameAsName = await server.call('read_function', { name: 'modShared.bas' });
    assert.equal(filenameAsName.error_kind, 'invalid_args');
  } finally {
    server.stop();
  }
});

test('search_code falls back to token matching and relaxed scope with metadata', async () => {
  const server = startServer(sampleEnv());
  try {
    const tokenSearch = await server.call('search_code', { query: 'SharedValue count', maxResults: 5 });
    assert.ok(tokenSearch.count >= 1, 'token fallback should match out-of-order words');
    assert.equal(tokenSearch.search_meta.stage, 'token');

    const relaxed = await server.call('search_code', { query: 'UseShared', scope: 'NoSuchDir', maxResults: 5 });
    assert.ok(relaxed.count >= 1);
    assert.equal(relaxed.search_meta.scopeRelaxed, true);

    const backslash = await server.call('search_code', { query: 'UseShared', scope: 'Client\\source', maxResults: 5 });
    assert.ok(backslash.count >= 1, 'backslash scope should be normalized');
    assert.equal(backslash.search_meta.scopeRelaxed, false);

    const fileScope = await server.call('search_code', { query: 'UseShared', scope: 'modSample.bas', maxResults: 5 });
    assert.ok(fileScope.count >= 1, 'filename scope should match as a path segment');
    assert.ok(fileScope.results.every((item) => item.file.toLowerCase().endsWith('modsample.bas')));

    // Filename matches are one result per file, not one per line.
    const flood = await server.call('search_code', { query: 'modshared', maxResults: 50 });
    const fileKindHits = flood.results.filter((item) => item.matchKind === 'file');
    assert.ok(fileKindHits.length <= 1, `filename match must not flood: got ${fileKindHits.length} file-kind hits`);
  } finally {
    server.stop();
  }
});

test('ambiguous filenames auto-resolve via configured source dirs, stay ambiguous otherwise', async () => {
  const preferred = startServer(projectScopeEnv({ VB6_LSP_SOURCE_DIRS: 'AppA/source' }));
  try {
    const resolved = await preferred.call('read_function', { file: 'modShared.bas', name: 'SharedEntry' });
    assert.equal(resolved.file, 'AppA/source/modShared.bas');
    assert.ok(resolved.resolution_note, 'auto-resolution should be explained');
    assert.ok(Array.isArray(resolved.alternates) && resolved.alternates.includes('AppB/source/modShared.bas'));

    const moduleInfo = await preferred.call('module_info', { file: 'modShared.bas' });
    assert.equal(moduleInfo.file, 'AppA/source/modShared.bas');

    // The caller's own path fragment beats the preferred dir.
    const explicit = await preferred.call('read_function', { file: 'AppB/modShared.bas', name: 'SharedEntry' });
    assert.equal(explicit.file, 'AppB/source/modShared.bas');
  } finally {
    preferred.stop();
  }

  const unbiased = startServer(projectScopeEnv());
  try {
    const stillAmbiguous = await unbiased.call('module_info', { file: 'modShared.bas' });
    assert.equal(stillAmbiguous.error_kind, 'ambiguous_file');
    assert.equal(stillAmbiguous.candidate_count, 2);

    // read_function-level tie (routine in both copies, no preference) stays an error too.
    const tie = await unbiased.call('read_function', { file: 'modShared.bas', name: 'SharedEntry' });
    assert.equal(tie.error_kind, 'ambiguous_file');
  } finally {
    unbiased.stop();
  }
});

test('read_function never silently serves one of several routine definitions', async () => {
  const server = startServer(projectScopeEnv());
  try {
    // Name-only with two definitions (AppA + AppB) must error with candidates.
    const nameOnly = await server.call('read_function', { name: 'SharedEntry' });
    assert.equal(nameOnly.error, true);
    assert.ok(Array.isArray(nameOnly.routineCandidates) && nameOnly.routineCandidates.length === 2);

    // Wrong file + routine that exists in MULTIPLE other files: error listing them.
    const wrongFile = await server.call('read_function', { file: 'modSharedDuplicate.bas', name: 'SharedEntry' });
    assert.equal(wrongFile.error_kind, 'not_found');
    assert.ok(Array.isArray(wrongFile.routineCandidates) && wrongFile.routineCandidates.length === 2);
  } finally {
    server.stop();
  }
});

test('read_function recovers when the routine lives in a different file', async () => {
  const server = startServer(sampleEnv());
  try {
    const recovered = await server.call('read_function', { file: 'modShared.bas', name: 'Demo' });
    assert.equal(recovered.symbol.name, 'Demo');
    assert.match(recovered.file, /modSample\.bas$/);
    assert.ok(recovered.resolution_note);

    const notFound = await server.call('read_function', { file: 'modShared.bas', name: 'DemoXyz' });
    assert.equal(notFound.error_kind, 'not_found');
    assert.ok(Array.isArray(notFound.routineCandidates));
  } finally {
    server.stop();
  }
});

test('batch_read_function applies the same rescue pipeline per item', async () => {
  const server = startServer(sampleEnv());
  try {
    const batch = await server.call('batch_read_function', {
      functions: [
        { file: 'modShared.bas', name: 'UseShared' },     // happy path
        { file: 'modShared.bas', name: 'Demo' },          // wrong file, unique routine -> recovered
        { file: 'modShared.bas', name: 'NopeNope' },      // unknown routine -> not_found
      ],
    });
    assert.equal(batch.functionCount, 3);

    const happy = batch.results[0];
    assert.equal(happy.error, null);
    assert.equal(happy.name, 'UseShared');

    const recovered = batch.results[1];
    assert.equal(recovered.error, null);
    assert.match(recovered.file, /modSample\.bas$/);
    assert.ok(recovered.resolution_note, 'batch recovery must carry a resolution_note');

    const missing = batch.results[2];
    assert.equal(missing.error_kind, 'not_found');
    assert.ok(Array.isArray(missing.routineCandidates));
  } finally {
    server.stop();
  }

  const ambiguous = startServer(projectScopeEnv());
  try {
    const batch = await ambiguous.call('batch_read_function', {
      functions: [{ file: 'modShared.bas', name: 'SharedEntry' }],
    });
    assert.equal(batch.results[0].error_kind, 'ambiguous_file');
    assert.ok(Array.isArray(batch.results[0].candidates));
  } finally {
    ambiguous.stop();
  }
});

test('stale index is rebuilt when a new file appears on disk (probe path)', async () => {
  const sourceRoot = path.resolve(__dirname, 'fixtures', 'sample-workspace');
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb6-lsp-stale-'));
  fs.cpSync(sourceRoot, rootDir, { recursive: true });

  const server = startServer({
    VB6_LSP_ROOT: rootDir,
    VB6_LSP_PROJECT_FILES: path.join(rootDir, 'Client', 'TestClient.vbp'),
    // Freshness check disabled so ONLY the probe path can rescue this.
    VB6_LSP_FRESHNESS_INTERVAL_MS: '99999999',
  });
  try {
    // Deterministic ordering: the reindex RESPONSE proves the index was built
    // before the new file exists (exactly 2 files), closing the startup race.
    const stats = await server.call('reindex_vb6', {});
    assert.equal(stats.files, 2, 'index must be built BEFORE the new module exists');

    const newModule = path.join(rootDir, 'Client', 'source', 'modBrandNew.bas');
    fs.writeFileSync(newModule, [
      'Attribute VB_Name = "modBrandNew"',
      'Option Explicit',
      '',
      'Public Sub BrandNewRoutine()',
      '    Dim x As Long',
      '    x = 1',
      'End Sub',
      '',
    ].join('\r\n'), 'latin1');

    const rescued = await server.call('read_function', { file: 'modBrandNew.bas', name: 'BrandNewRoutine' });
    assert.equal(rescued.symbol?.name, 'BrandNewRoutine');
    assert.match(rescued.file, /modBrandNew\.bas$/);
  } finally {
    server.stop();
  }
});

test('freshness check rebuilds the index when files change on disk', async () => {
  const sourceRoot = path.resolve(__dirname, 'fixtures', 'sample-workspace');
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb6-lsp-fresh-'));
  fs.cpSync(sourceRoot, rootDir, { recursive: true });

  const server = startServer({
    VB6_LSP_ROOT: rootDir,
    VB6_LSP_PROJECT_FILES: path.join(rootDir, 'Client', 'TestClient.vbp'),
    VB6_LSP_FRESHNESS_INTERVAL_MS: '0', // check on every call
  });
  try {
    const before = await server.call('find_symbol', { name: 'FreshRoutine', includeBody: false });
    assert.equal(before.count, 0);

    // Edit an existing module on disk (mtime + size change).
    const modSample = path.join(rootDir, 'Client', 'source', 'modSample.bas');
    fs.appendFileSync(modSample, '\r\nPublic Sub FreshRoutine()\r\nEnd Sub\r\n', 'latin1');

    const after = await server.call('find_symbol', { name: 'FreshRoutine', includeBody: false });
    assert.equal(after.count, 1, 'freshness check should pick up the edited file');
  } finally {
    server.stop();
  }
});

test('probe reindex is gated: files outside indexed dirs and cooldown do not rebuild', async () => {
  const sourceRoot = path.resolve(__dirname, 'fixtures', 'sample-workspace');
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb6-lsp-cooldown-'));
  fs.cpSync(sourceRoot, rootDir, { recursive: true });
  // A real file on disk but OUTSIDE every indexed source dir.
  fs.mkdirSync(path.join(rootDir, 'Unindexed'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'Unindexed', 'modOutside.bas'), 'Attribute VB_Name = "modOutside"\r\nPublic Sub OutsideSub()\r\nEnd Sub\r\n', 'latin1');

  const server = startServer({
    VB6_LSP_ROOT: rootDir,
    VB6_LSP_PROJECT_FILES: path.join(rootDir, 'Client', 'TestClient.vbp'),
    VB6_LSP_FRESHNESS_INTERVAL_MS: '99999999',
  });
  try {
    await server.call('reindex_vb6', {});
    const buildsAfterIndex = server.indexBuildCount();

    // Outside every indexed dir -> probe must NOT trigger a rebuild.
    const outside = await server.call('read_function', { file: 'Unindexed/modOutside.bas', name: 'OutsideSub' });
    assert.ok(outside.error, 'file outside indexed dirs cannot be served');
    assert.equal(server.indexBuildCount(), buildsAfterIndex, 'no rebuild for a file no reindex could pick up');

    // First probe-eligible miss rebuilds; a second one within the cooldown must not.
    const moduleA = path.join(rootDir, 'Client', 'source', 'modCoolA.bas');
    fs.writeFileSync(moduleA, 'Attribute VB_Name = "modCoolA"\r\nPublic Sub CoolA()\r\nEnd Sub\r\n', 'latin1');
    const first = await server.call('read_function', { file: 'modCoolA.bas', name: 'CoolA' });
    assert.equal(first.symbol?.name, 'CoolA');
    const buildsAfterProbe = server.indexBuildCount();
    assert.equal(buildsAfterProbe, buildsAfterIndex + 1);

    const moduleB = path.join(rootDir, 'Client', 'source', 'modCoolB.bas');
    fs.writeFileSync(moduleB, 'Attribute VB_Name = "modCoolB"\r\nPublic Sub CoolB()\r\nEnd Sub\r\n', 'latin1');
    const second = await server.call('read_function', { file: 'modCoolB.bas', name: 'CoolB' });
    assert.ok(second.error, 'within the cooldown the probe must not rebuild again');
    assert.equal(server.indexBuildCount(), buildsAfterProbe, 'cooldown must prevent a second rebuild');
  } finally {
    server.stop();
  }
});
