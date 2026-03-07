const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveFileSymbols } = require('../out/mcp/mcp/utils.js');

test('resolveFileSymbols prefers exact relative paths and reports ambiguity otherwise', () => {
  const index = {
    byFile: new Map([
      ['Server/source/clsLoginClientTCP.cls', [{ name: 'ServerThing' }]],
      ['LoginServer/source/clsLoginClientTCP.cls', [{ name: 'LoginThing' }]],
      ['LoginServer/source/modMain.bas', [{ name: 'Main' }]],
    ]),
  };

  const exact = resolveFileSymbols(index, 'LoginServer/source/clsLoginClientTCP.cls');
  assert.ok(exact.match);
  assert.equal(exact.match.filePath, 'LoginServer/source/clsLoginClientTCP.cls');

  const ambiguous = resolveFileSymbols(index, 'clsLoginClientTCP.cls');
  assert.equal(ambiguous.match, null);
  assert.equal(ambiguous.ambiguity, 'ambiguous');
  assert.equal(ambiguous.candidates.length, 2);
});
