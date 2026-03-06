# VB6 Language Server 3.0.0

`3.0.0` marks the point where `vb6-lsp` becomes a stable agent-first MCP analysis surface in addition to being a practical VB6 language server.

## Highlights

- Stable bundled analysis tools
- Project-aware and agent-friendly MCP workflows
- Mature editor + MCP combination on top of the same VB6 engine

## What changed

The project now combines:

- editor-facing LSP features
- project-aware indexing from `.vbp`
- call-graph and mutation-oriented analysis
- specialized workflows for packet handlers and UI forms
- bundled one-call analyses for symbols and modules

## Why 3.0.0

Earlier releases exposed useful search and navigation primitives. `3.0.0` is the first release where the MCP layer stands on its own as a stable higher-level analysis interface for agents like Codex and Claude.

## Validation

- `22/22` automated tests passing
- LSP and MCP compatibility validated
- benchmark and release documentation kept up to date
