# VB6 Language Server

`vb6-lsp` is a Visual Basic 6 language server focused on real legacy VB6 workspaces, including multi-project `.vbp` layouts.

Status: `1.0.0`

## Current capabilities

- Go to definition
- Find references
- Hover
- Document symbols
- Workspace symbols
- Completion
- Signature help
- Rename
- Diagnostics for missing block terminators, duplicate public symbols, and missing `Option Explicit`
- `.vbp`-aware workspace discovery
- MCP server for code search / symbol lookup workflows

## MCP tools

The built-in MCP server exposes:

- `find_symbol`
- `list_symbols`
- `find_references`
- `search_code`
- `read_function`
- `signature`
- `module_info`
- `index_stats`
- `reindex_vb6`

## Workspace discovery

By default the server:

1. Uses the active workspace root.
2. Discovers `.vbp` files recursively.
3. Extracts source directories from `Module=`, `Class=`, `Form=` and related entries.
4. Merges any extra `vb6.sourcePaths` configured by the user.

You can override this with settings:

```json
{
  "vb6.workspaceRoot": "C:/path/to/workspace",
  "vb6.projectFiles": ["ProjectA/App.vbp", "Shared/Library.vbp"],
  "vb6.sourcePaths": ["src", "shared", "legacy/forms"],
  "vb6.preferProjectFiles": true
}
```

## Scripts

```bash
npm run build:all
npm run lsp:stdio
npm run mcp:stdio
npm test
```

## MCP usage

The repo now includes an MCP stdio server at:

```text
out/mcp/mcp/server.js
```

Useful environment variables:

- `VB6_LSP_ROOT`
- `VB6_LSP_PROJECT_FILES`
- `VB6_LSP_SOURCE_DIRS`
- `VB6_LSP_PREFER_PROJECT_FILES`

## 1.0 scope

`1.0.0` is intended to be stable for real-world VB6 navigation and indexed code exploration workflows:

- portable workspace discovery via `.vbp`
- project-wide navigation and symbol search
- contextual local/parameter-aware resolution for the main authoring features
- official stdio MCP server included in the repo

It is still not a full compiler or full type-inference engine for every corner of VB6/COM metadata.

## Validation

The repo includes automated tests covering:

- `.vbp` config discovery
- indexer behavior for module symbols, properties, locals and parameters
- LSP end-to-end requests over stdio
- MCP stdio tool exposure, indexing, and richer tool workflows
