# VB6 Language Server 3.1.0

`3.1.0` is a refinement release focused on better agent guidance and better editor diagnostics.

## Highlights

- Unresolved routine diagnostics with quick fixes
- Better semantic token coverage on usage sites
- Directional flow and state-oriented MCP analysis

## New MCP tools

- `trace_inbound_flow`
- `trace_outbound_flow`
- `analyze_state_symbol`

## Editor improvements

- Warns about unresolved routines
- Offers a quick fix to create a stub routine
- Improves semantic token classification for more usage scenarios

## Validation

- `23/23` automated tests passing
