# VB6 Language Server 2.2.0

`2.2.0` is a semantics and agent-workflow release.

## Highlights

- Better type inference beyond simple `New` assignments
- Richer `.vbp` reference / COM metadata
- More MCP tools for project and reference exploration

## Type inference improvements

- Follow assignments from typed variables
- Follow assignments from typed factory functions
- Preserve the existing `New SomeClass` inference path

## Project / reference metadata

- Added richer parsing for `.vbp` references
- Exposed version, library name, and basic existence metadata for external references

## MCP improvements

New tools:

- `list_projects`
- `reference_info`
- `type_members`

These are aimed at making project exploration and agent-driven investigation easier without falling back immediately to raw text search.

## Validation

- `16/16` automated tests passing
- existing LSP, MCP, and compatibility coverage retained
