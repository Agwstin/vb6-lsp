const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveWorkspaceConfig } = require('../out/server/config.js');

test('workspace config exposes project metadata and external references from .vbp files', () => {
  const rootDir = path.resolve(__dirname, 'fixtures', 'advanced-workspace');
  const config = resolveWorkspaceConfig({
    rootUri: `file:///${rootDir.replace(/\\/g, '/')}`,
    settings: {},
  });

  assert.equal(config.projects.length, 1);
  assert.equal(config.projects[0].name, 'AdvancedApp');
  const ole = config.externalReferences.find((reference) => reference.description === 'OLE Automation');
  assert.ok(ole);
  assert.equal(ole.version, '2.0.0');
  assert.equal(ole.libraryName, 'stdole2.tlb');
  assert.ok(config.objectReferences.some((reference) => reference.description === 'mscomctl.ocx'));
});
