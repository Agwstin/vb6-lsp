const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildVB6Index } = require('../out/server/indexer/mcp-bridge.js');

function listFiles(rootDir) {
  const results = [];
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else results.push(fullPath);
    }
  };
  visit(rootDir);
  return results;
}

function copyFixture(destination) {
  const fixture = path.resolve(__dirname, 'fixtures', 'sample-workspace');
  fs.cpSync(fixture, destination, {
    recursive: true,
    filter: (sourcePath) => path.basename(sourcePath) !== '.vb6-lsp-cache',
  });
  return path.join(destination, 'Client', 'source');
}

test('MCP index cache stays outside the workspace by default and supports explicit local opt-in', () => {
  const oldCacheDir = process.env.VB6_LSP_CACHE_DIR;
  const oldCacheMode = process.env.VB6_LSP_CACHE_MODE;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vb6-lsp-cache-policy-'));
  const userCacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vb6-lsp-user-cache-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const localRoot = path.join(tempRoot, 'local-workspace');

  try {
    const sourceDir = copyFixture(workspaceRoot);
    process.env.VB6_LSP_CACHE_DIR = userCacheRoot;
    process.env.VB6_LSP_CACHE_MODE = 'user';
    buildVB6Index(workspaceRoot, [sourceDir]);

    assert.equal(fs.existsSync(path.join(workspaceRoot, '.vb6-lsp-cache')), false);
    assert.ok(listFiles(userCacheRoot).some((file) => file.endsWith('.json')));

    const localSourceDir = copyFixture(localRoot);
    delete process.env.VB6_LSP_CACHE_DIR;
    process.env.VB6_LSP_CACHE_MODE = 'workspace';
    buildVB6Index(localRoot, [localSourceDir]);

    const localCache = path.join(localRoot, '.vb6-lsp-cache');
    assert.ok(listFiles(localCache).some((file) => file.endsWith('.json')));
  } finally {
    if (oldCacheDir === undefined) delete process.env.VB6_LSP_CACHE_DIR;
    else process.env.VB6_LSP_CACHE_DIR = oldCacheDir;
    if (oldCacheMode === undefined) delete process.env.VB6_LSP_CACHE_MODE;
    else process.env.VB6_LSP_CACHE_MODE = oldCacheMode;
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(userCacheRoot, { recursive: true, force: true });
  }
});

test('MCP cache hits reuse valid entries, rebuild stale files, and isolate workspace keys', () => {
  const oldCacheDir = process.env.VB6_LSP_CACHE_DIR;
  const oldCacheMode = process.env.VB6_LSP_CACHE_MODE;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vb6-lsp-cache-integrity-'));
  const cacheRoot = path.join(tempRoot, 'user-cache');
  const workspaceA = path.join(tempRoot, 'workspace-a');
  const workspaceB = path.join(tempRoot, 'workspace-b');

  try {
    const sourceA = copyFixture(workspaceA);
    process.env.VB6_LSP_CACHE_DIR = cacheRoot;
    delete process.env.VB6_LSP_CACHE_MODE;

    const first = buildVB6Index(workspaceA, [sourceA]);
    const firstCacheFiles = listFiles(cacheRoot).filter((file) => file.endsWith('.json'));
    assert.equal(firstCacheFiles.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(firstCacheFiles[0], 'utf8')).cacheVersion, 2);

    const hit = buildVB6Index(workspaceA, [sourceA]);
    assert.equal(hit.symbols.length, first.symbols.length);

    const changedFile = path.join(sourceA, 'modSample.bas');
    fs.appendFileSync(changedFile, '\r\nPublic Sub CacheFresh()\r\nEnd Sub\r\n', 'latin1');
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(changedFile, future, future);
    const rebuilt = buildVB6Index(workspaceA, [sourceA]);
    assert.ok(rebuilt.byName.has('cachefresh'));

    const migratedPayload = JSON.parse(fs.readFileSync(firstCacheFiles[0], 'utf8'));
    migratedPayload.cacheVersion = 1;
    fs.writeFileSync(firstCacheFiles[0], JSON.stringify(migratedPayload), 'utf8');
    buildVB6Index(workspaceA, [sourceA]);
    assert.equal(JSON.parse(fs.readFileSync(firstCacheFiles[0], 'utf8')).cacheVersion, 2);

    const sourceB = copyFixture(workspaceB);
    buildVB6Index(workspaceB, [sourceB]);
    const allCacheFiles = listFiles(cacheRoot).filter((file) => file.endsWith('.json'));
    assert.equal(allCacheFiles.length, 2);
  } finally {
    if (oldCacheDir === undefined) delete process.env.VB6_LSP_CACHE_DIR;
    else process.env.VB6_LSP_CACHE_DIR = oldCacheDir;
    if (oldCacheMode === undefined) delete process.env.VB6_LSP_CACHE_MODE;
    else process.env.VB6_LSP_CACHE_MODE = oldCacheMode;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
