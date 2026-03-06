# VB6 Language Server 3.3.1

`3.3.1` adds the local, opt-in telemetry layer that should have landed before broader post-3.0 work.

## Highlights

- Local MCP telemetry
- Opt-in only
- No prompt or source-content logging

## What gets recorded

- tool name
- duration
- result count
- output size
- cache hit state
- error presence
- anonymized workspace id

## Privacy note

This telemetry is intentionally local and metadata-only. It is designed to help guide future improvements based on real usage without storing prompts or source-code content.
