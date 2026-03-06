# VB6 Language Server 2.5.0

`2.5.0` is the first clearly agent-first release of `vb6-lsp`.

## Highlights

- Higher-level MCP tools for explanation and tracing
- Lightweight call-graph caching for repeated agent workflows
- Better result shapes for LLM consumption

## New MCP tools

- `explain_symbol`
- `find_callers`
- `find_callees`
- `trace_flow`
- `find_related_symbols`
- `find_state_mutations`
- `find_network_entrypoints`
- `find_ui_entrypoints`

## Why this release matters

Until now the MCP layer mostly exposed useful primitives. `2.5.0` starts turning that into a more agent-native analysis surface by returning:

- likely definitions
- related modules
- lightweight summaries
- caller/callee relationships
- mutation-style hits
- probable entrypoints for common legacy patterns

## Validation

- `20/20` automated tests passing
- existing editor and MCP compatibility retained
