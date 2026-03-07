# VB6 Language Server 3.3.2

`3.3.2` is a focused bugfix release for MCP file resolution.

## Fixes

- Prefer exact relative-path matches before suffix-based file matching
- Avoid silently choosing the wrong file when duplicate filenames exist across multiple VB6 projects
- Surface candidate files when a lookup is ambiguous

## Validation

- Added regression coverage for ambiguous file resolution
- Full automated suite remains green
