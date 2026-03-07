# Changelog

## 3.3.2 - 2026-03-07

- Improved MCP file resolution to prefer exact relative-path matches and avoid silently picking the wrong file when duplicate filenames exist across projects.
- Added ambiguity reporting for file-based MCP lookups.
- Added regression coverage for ambiguous file resolution.

## 3.3.1 - 2026-03-06

- Added local opt-in MCP telemetry for tool usage analysis.
- Records non-sensitive per-tool metadata such as duration, counts, output size, cache state, and errors.
- Added tests covering telemetry logging behavior.

## 3.3.0 - 2026-03-06

- Added safer unresolved-symbol analysis for `With` receivers.
- Added project-level MCP workflows such as `analyze_startup_flow` and `analyze_project_reference_impact`.
- Expanded semantic/member usage precision and domain-neutral investigation coverage.
- Expanded the automated suite to `25/25` passing tests.

## 3.2.0 - 2026-03-06

- Added more explicit caches and smarter ranking/trimming for analysis-heavy MCP tools.
- Improved bundled analysis outputs with confidence, counts, suggested next symbols, and match scores.
- Expanded flow, entrypoint, and related-symbol heuristics further.
- Kept the suite green at `23/23` passing tests.

## 3.1.0 - 2026-03-06

- Added unresolved routine diagnostics with a quick fix to create stub routines.
- Improved semantic token classification across more usage sites, including member-style access.
- Added more domain-agnostic agent workflows such as `trace_inbound_flow`, `trace_outbound_flow`, and `analyze_state_symbol`.
- Expanded the automated suite to `23/23` passing tests.

## 3.0.0 - 2026-03-06

- Consolidated the MCP layer into a stable agent-first analysis surface.
- Added bundled analysis tools such as `analyze_symbol` and `analyze_module`.
- Completed the progression from low-level search primitives toward higher-level explanation, tracing, mutation, entrypoint, and workflow-oriented tools.
- Expanded the automated suite to `22/22` passing tests.

## 2.6.0 - 2026-03-06

- Added specialized agent workflows such as `summarize_module`, `analyze_packet_handler`, and `analyze_ui_form`.
- Improved result shapes for agent-oriented explanations and traces.
- Added more heuristics for state and flow analysis.
- Expanded the automated suite to `21/21` passing tests.

## 2.5.0 - 2026-03-06

- Added agent-oriented analysis tools including `explain_symbol`, `find_callers`, `find_callees`, `trace_flow`, `find_related_symbols`, `find_state_mutations`, `find_network_entrypoints`, and `find_ui_entrypoints`.
- Added a derived MCP cache for repeated agent-oriented analyses such as call-graph exploration.
- Improved result shapes for agent consumption with summaries, related modules, likely definitions, and lightweight match reasons.
- Expanded the automated suite to `20/20` passing tests.

## 2.4.0 - 2026-03-06

- Added diagnostics for missing external project references on files that belong to affected `.vbp` projects.
- Expanded semantic tokens beyond declarations so symbol usages receive richer highlighting.
- Added an additional quick fix for duplicate Public symbols with explicit visibility.
- Expanded compatibility coverage to `19/19` passing tests.

## 2.3.0 - 2026-03-06

- Added form/control awareness for `.frm` designer controls.
- Added support for member access inside `With ... End With` blocks.
- Improved document symbol output for member-like symbols that do not have an explicit parent symbol.
- Added more real-world compatibility fixtures and expanded the suite to `17/17` passing tests.

## 2.2.0 - 2026-03-06

- Expanded type inference to follow assignments from typed variables and typed factory functions.
- Improved `.vbp` reference parsing with richer metadata such as versions, library names, and existence checks.
- Added more agent-oriented MCP tools: `list_projects`, `reference_info`, and `type_members`.
- Expanded the automated suite to `16/16` passing tests.

## 2.1.1 - 2026-03-06

- Fixed the test runner command so CI works reliably on Windows runners.
- Replaced the shell glob-based test invocation with a portable Node-based test launcher.

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
