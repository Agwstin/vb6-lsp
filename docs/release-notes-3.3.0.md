# VB6 Language Server 3.3.0

`3.3.0` is a final general-purpose refinement release before further work should be guided by observed usage.

## Highlights

- Safer unresolved-symbol diagnostics
- Startup-flow and project-reference impact analysis
- More domain-neutral investigation coverage without hardcoding product logic

## New workflows

- `analyze_startup_flow`
- `analyze_project_reference_impact`

## Validation

- `25/25` automated tests passing

## Strategic note

At this point the MCP/LSP surface is broad and mature enough that the next wave of changes should ideally be guided by real usage and telemetry, not by adding heuristics blindly.
