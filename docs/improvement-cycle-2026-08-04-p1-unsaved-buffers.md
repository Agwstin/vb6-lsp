# Improvement cycle: P1 unsaved-buffer authority (2026-08-04)

## Scope

Make open VB6 documents the source of truth for the LSP index and source-consuming providers. Closed documents continue to fall back to disk. This cycle covers the shared snapshot source, indexer convergence, diagnostics, semantic tokens, references, rename, and code actions.

Explicitly out of scope: supported-component expansion, provider-matrix expansion unrelated to snapshots, MCP cache relocation, multi-root routing, performance optimization, FRX, release publication, and external messages.

## Proof before code

- Failure signature: `documents.onDidChangeContent` calls `indexer.rebuildFile(filePath)`, which rereads saved disk content; diagnostics, semantic tokens, references, rename, and code actions also call `fs.readFileSync` independently.
- Cheapest discriminating evidence: the current server/indexer/provider call sites and a protocol test that changes an open buffer without saving.
- User-visible acceptance: content from `didOpen` and then `didChange` is authoritative for workspace/navigation requests, a missing `End` diagnostic is published from unsaved text, semantic tokens cover the unsaved declaration, references and rename use unsaved line ranges, and closing the document makes the index converge back to disk.
- Required test layer: protocol/E2E over stdio; static inspection is available in this cycle, but the compiled server test requires the user-run build/test gate.
- Rollback boundary: new snapshot/index/provider files and the focused regression only; preserve all pre-existing dirty files and unrelated P0 edits.

## Intended files

- `src/server/documentStore.ts`
- `src/server/indexer/indexer.ts`
- `src/server/server.ts`
- `src/server/typeInference.ts`, `src/server/memberAccess.ts`
- `src/server/providers/diagnostics.ts`, `semanticTokens.ts`, `references.ts`, `rename.ts`, `codeActions.ts`
- `tests/lsp-unsaved-buffer.test.js`

## Discarded hypotheses

- Disk watcher freshness alone cannot solve this: it only observes saved filesystem state and therefore cannot see an unsaved editor buffer.
- Reusing only the current `TextDocument` is insufficient: references, rename, semantic tokens, diagnostics, and code actions read target/current files outside their existing document parameter.
