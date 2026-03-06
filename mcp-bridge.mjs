// ESM entry point — re-exports from CJS-compiled bridge
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const bridge = require('./out/mcp/server/indexer/mcp-bridge.js');
export const { buildVB6Index, findReferences, searchCode } = bridge;
