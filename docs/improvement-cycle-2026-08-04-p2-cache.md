# Improvement cycle: P2 MCP cache location (2026-08-04)

## Scope

Move the MCP index cache default outside the analyzed repository. Keep workspace-local storage available only through an explicit opt-in, and preserve cache invalidation semantics. This cycle does not change the in-memory derived cache, index algorithms, telemetry, multi-root routing, or cache contents beyond a version bump for the supported-source policy.

## Failure signature and cheapest evidence

`src/server/indexer/mcp-bridge.ts` writes `sourcePath/.vb6-lsp-cache/mcp-index-<key>.json` on the first `buildVB6Index` call. That mutates a read-oriented consumer repository. The cheapest proof is an isolated build against a temporary copy with a dedicated cache directory: the default path must remain absent while the configured cache directory receives the index.

## Design

- `VB6_LSP_CACHE_DIR` explicitly selects a cache root.
- Otherwise `VB6_LSP_CACHE_MODE=workspace` opts into the historical `<workspace>/.vb6-lsp-cache` location.
- The default uses the platform user cache location (`LOCALAPPDATA`/`APPDATA`, `~/Library/Caches`, or `XDG_CACHE_HOME`/`~/.cache`) under `vb6-lsp`.
- The cache key continues to include the normalized workspace and source directories, so separate workspaces do not collide.

## Privacy and lifecycle

Snapshots include parsed symbols and cached source lines; they are local, unencrypted data and may be sensitive. There is no automatic TTL. Cache entries are invalidated by cache-version changes or by a changed workspace/source-directory key, path, size, or rounded modification time. Manual deletion is documented for the platform cache roots and the explicit `VB6_LSP_CACHE_DIR`/workspace-local modes in the README.

## Acceptance criterion

The isolated cache-policy tests prove that the default/configured path does not create `.vb6-lsp-cache` in the analyzed workspace, that the explicit cache root receives a JSON index, that valid entries can be reused, that changed files rebuild stale entries, that cache version 1 is migrated by rebuilding to version 2, that distinct workspaces get distinct keys, and that workspace-local caching is still available only when requested.

## Verification layer

- Static: source syntax parse, path-policy inspection, `git diff --check`.
- Isolated: `node --test tests/cache-policy.test.js`; the current pre-change `out/` is expected to fail the default-location assertion until the user rebuilds it.
- Protocol/suite: pending the user's approved `npm test` gate; this agent does not compile the server.
- Real project: out of scope for this cycle.

## Rollback boundary

Rollback is limited to the cache-path implementation, its focused regression, and this note. The existing `.gitignore` entry remains because workspace-local caching is an explicit supported mode.
