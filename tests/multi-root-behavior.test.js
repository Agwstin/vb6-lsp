const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { resolveWorkspaceConfig } = require('../out/server/config.js');

test('workspace configuration uses the first folder when multiple roots are supplied', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'project-scope-workspace');
  const firstRoot = path.join(rootDir, 'AppA');
  const secondRoot = path.join(rootDir, 'AppB');
  const config = resolveWorkspaceConfig({
    workspaceFolders: [
      { uri: pathToFileURL(firstRoot).href },
      { uri: pathToFileURL(secondRoot).href },
    ],
    settings: {},
  });

  assert.equal(config.rootDir.toLowerCase(), firstRoot.toLowerCase());
  assert.ok(config.projectFiles.some((file) => file.toLowerCase().endsWith(path.join('appa', 'appa.vbp').toLowerCase())));
  assert.ok(!config.projectFiles.some((file) => file.toLowerCase().endsWith(path.join('appb', 'appb.vbp').toLowerCase())));
});
