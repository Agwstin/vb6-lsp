# Changelog

## 1.0.0 - 2026-03-06

- Removed hardcoded Imperium-only workspace assumptions from the LSP server.
- Added `.vbp`-aware workspace discovery and configurable workspace/project/source settings.
- Improved symbol modeling to include canonical properties, parameters, and local variables.
- Improved definition, hover, references, rename, completion, diagnostics, document symbols, and signature help using contextual resolution.
- Added an official stdio MCP server inside the repo.
- Added MCP tools for symbol lookup, references, code search, function reading, signatures, and module summaries.
- Added automated tests for config discovery, indexing, LSP e2e, and MCP e2e.

## 0.5.0-beta.1 - 2026-03-06

- First beta with portable workspace config, official MCP server, and automated tests.
