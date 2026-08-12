const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveFileSymbols } = require('../out/mcp/mcp/utils.js');

function makeIndex(entries) {
  return { byFile: new Map(entries) };
}

test('ambiguous filenames resolve to the candidate containing the requested routine', () => {
  const index = makeIndex([
    ['Common/Client/clsTileEngineX.cls', [{ name: 'Engine_Init', kind: 'Sub' }, { name: 'Char_Render', kind: 'Sub' }]],
    ['Tools/Particle Editor/Codigo/clsTileEngineX.cls', [{ name: 'Engine_Init', kind: 'Sub' }]],
  ]);

  const resolved = resolveFileSymbols(index, 'clsTileEngineX.cls', { routineName: 'Char_Render' });
  assert.ok(resolved.match);
  assert.equal(resolved.match.filePath, 'Common/Client/clsTileEngineX.cls');
  assert.equal(resolved.resolution, 'contains-routine');
  assert.deepEqual(resolved.candidates, ['Tools/Particle Editor/Codigo/clsTileEngineX.cls']);
});

test('routine containment BEATS preferred dir when the signals conflict', () => {
  // Routine lives only in the NON-preferred copy; preferDirs point at the other.
  // The routine signal must win — a comparator inversion would flip this test.
  const index = makeIndex([
    ['Common/Client/clsTileEngineX.cls', [{ name: 'Engine_Init', kind: 'Sub' }]],
    ['Tools/Particle Editor/Codigo/clsTileEngineX.cls', [{ name: 'Engine_Init', kind: 'Sub' }, { name: 'Legacy_Render', kind: 'Sub' }]],
  ]);

  const resolved = resolveFileSymbols(index, 'clsTileEngineX.cls', {
    routineName: 'Legacy_Render',
    preferDirs: ['Common'],
  });
  assert.ok(resolved.match);
  assert.equal(resolved.match.filePath, 'Tools/Particle Editor/Codigo/clsTileEngineX.cls');
  assert.equal(resolved.resolution, 'contains-routine');
});

test('the directory the caller typed BEATS routine containment and preferred dirs', () => {
  // 'AppB/modShared.bas' is a slightly-wrong path for AppB/source/modShared.bas.
  // Even with preferDirs pointing at AppA, the explicit AppB must win.
  const index = makeIndex([
    ['AppA/source/modShared.bas', [{ name: 'SharedEntry', kind: 'Sub' }]],
    ['AppB/source/modShared.bas', [{ name: 'SharedEntry', kind: 'Sub' }]],
  ]);

  const resolved = resolveFileSymbols(index, 'AppB/modShared.bas', {
    routineName: 'SharedEntry',
    preferDirs: ['AppA/source'],
  });
  assert.ok(resolved.match);
  assert.equal(resolved.match.filePath, 'AppB/source/modShared.bas');
  assert.equal(resolved.resolution, 'matches-request-path');
});

test('ambiguous filenames resolve to the candidate inside a preferred source dir', () => {
  const index = makeIndex([
    ['Common/Client/clsTileEngineX.cls', [{ name: 'Engine_Init', kind: 'Sub' }]],
    ['Tools/Particle Editor/Codigo/clsTileEngineX.cls', [{ name: 'Engine_Init', kind: 'Sub' }]],
  ]);

  const resolved = resolveFileSymbols(index, 'clsTileEngineX.cls', {
    routineName: 'Engine_Init',
    preferDirs: ['Common', 'Client/SOURCE'],
  });
  assert.ok(resolved.match);
  assert.equal(resolved.match.filePath, 'Common/Client/clsTileEngineX.cls');
  assert.equal(resolved.resolution, 'preferred-source-dir');
});

test('non-routine symbols (variables) do not count as routine containment', () => {
  const index = makeIndex([
    ['Client/source/modA.bas', [{ name: 'Estado', kind: 'Variable' }]],
    ['Server/source/modA.bas', [{ name: 'Estado', kind: 'Sub' }]],
  ]);

  const resolved = resolveFileSymbols(index, 'modA.bas', { routineName: 'Estado' });
  assert.ok(resolved.match);
  assert.equal(resolved.match.filePath, 'Server/source/modA.bas');
  assert.equal(resolved.resolution, 'contains-routine');
});

test('a true tie stays ambiguous with ranked candidates', () => {
  const index = makeIndex([
    ['AppA/source/modShared.bas', [{ name: 'SharedEntry', kind: 'Sub' }]],
    ['AppB/source/modShared.bas', [{ name: 'SharedEntry', kind: 'Sub' }]],
  ]);

  const resolved = resolveFileSymbols(index, 'modShared.bas', { routineName: 'SharedEntry' });
  assert.equal(resolved.match, null);
  assert.equal(resolved.ambiguity, 'ambiguous');
  assert.equal(resolved.candidates.length, 2);
});

test('fuzzy filename resolution: exact normalized basename matches, contains does NOT auto-match', () => {
  const index = makeIndex([
    ['Client/SOURCE/modGfx11.bas', [{ name: 'Gfx_Init', kind: 'Sub' }]],
    ['Client/source/modClient.bas', [{ name: 'Client_Init', kind: 'Sub' }]],
  ]);

  const noExtension = resolveFileSymbols(index, 'modGfx11');
  assert.ok(noExtension.match);
  assert.equal(noExtension.match.filePath, 'Client/SOURCE/modGfx11.bas');
  assert.equal(noExtension.resolution, 'fuzzy-filename');

  const oddCase = resolveFileSymbols(index, 'MODGFX11.BAS');
  assert.ok(oddCase.match, 'uppercase exact filename should match case-insensitively');

  // A contains/prefix-only match must NOT hijack a request for a file that does
  // not exist in the index (it could be a brand-new file the stale probe should find).
  const containsOnly = resolveFileSymbols(index, 'modGfx1.bas');
  assert.equal(containsOnly.match, null);
  assert.ok(containsOnly.candidates.includes('Client/SOURCE/modGfx11.bas'), 'near-miss should still be offered as candidate');
});

test('empty and unknown file inputs return clean no-match results', () => {
  const index = makeIndex([
    ['Client/source/modClient.bas', [{ name: 'Client_Init', kind: 'Sub' }]],
  ]);

  const empty = resolveFileSymbols(index, '');
  assert.equal(empty.match, null);
  assert.equal(empty.candidates.length, 0);

  const unknown = resolveFileSymbols(index, 'totallyMissing.bas');
  assert.equal(unknown.match, null);
});
