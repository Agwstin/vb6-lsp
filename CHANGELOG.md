# Changelog

## 2.1.0 - 2026-03-06

- Added semantic tokens for richer editor highlighting of indexed VB6 declarations.
- Added basic code actions for common diagnostics such as missing `Option Explicit` and missing `End` blocks.
- Added GitHub Actions CI for build and test validation on push and pull requests.
- Expanded automated coverage to `14/14` passing tests.

## 2.0.0 - 2026-03-06

- Added typed member access for completion, definition, hover, and signature help when the receiver type is known.
- Added Type-field indexing and `Implements` indexing for richer semantic analysis.
- Added `.vbp` project metadata parsing for project names, external references, and object references.
- Added basic type inference for common local assignment patterns such as `Set x = New SomeClass`.
- Added folding ranges for multiline VB6 routines and blocks.
- Added `project_info` MCP tooling plus richer project/index stats.
- Expanded fixtures and tests to cover member access, folding ranges, project metadata, type inference, and additional parser edge cases.
- Added a reproducible benchmark script and benchmark documentation.
- Added a VS Code packaging script for generating `.vsix` artifacts.

## 1.2.0 - 2026-03-06

- Added basic type inference from declarations and common assignments.
- Added deeper `.vbp` project/reference parsing.
- Exposed project/reference metadata through MCP.

## 1.1.0 - 2026-03-06

- Improved parser coverage for more declaration edge cases.
- Added more fixtures and regression tests.
- Improved completion ranking and contextual relevance.

## 1.0.0 - 2026-03-06

- Removed hardcoded workspace-specific assumptions from the LSP server.
- Added `.vbp`-aware workspace discovery and configurable workspace/project/source settings.
- Improved symbol modeling to include canonical properties, parameters, and local variables.
- Improved definition, hover, references, rename, completion, diagnostics, document symbols, and signature help using contextual resolution.
- Added an official stdio MCP server inside the repo.
- Added MCP tools for symbol lookup, references, code search, function reading, signatures, and module summaries.
- Added automated tests for config discovery, indexing, LSP e2e, and MCP e2e.

## 0.5.0-beta.1 - 2026-03-06

- First beta with portable workspace config, official MCP server, and automated tests.
