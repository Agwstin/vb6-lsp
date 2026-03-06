const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveWorkspaceConfig } = require('../out/server/config.js');

test('resolveWorkspaceConfig discovers source directories from .vbp files', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'sample-workspace');
  const config = resolveWorkspaceConfig({
    rootUri: `file:///${rootDir.replace(/\\/g, '/')}`,
    settings: {},
  });

  assert.equal(config.projectFiles.length, 1);
  assert.ok(config.projectFiles[0].endsWith(path.join('Client', 'TestClient.vbp')));
  assert.ok(config.sourceDirs.some((value) => value.endsWith(path.join('Client', 'source'))));
  assert.ok(config.sourceDirs.some((value) => value.endsWith('Common')));
});
