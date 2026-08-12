# Changelog

## 3.4.0 - Unreleased

This is the unreleased 3.4.0 source candidate. It is not the public GitHub release: the latest published release remains 3.3.2 until a clean verification and install smoke test are complete.

The telemetry figures and prior suite claim from the existing worktree are historical evidence, not results of the current cycle. The maintainer-provided follow-up gate compiled the pre-resource candidate, passed 63/63 tests, reported zero npm audit vulnerabilities, and produced a fresh VSIX whose required runtime files are present without telemetry/log/launch leaks. The later `inspect_frx`/`inspect_res` source slices still need that same compiled/package gate. Real-project/clean-install validation remains pending.

Telemetry-driven rescue release: 7,072 real MCP calls showed `search_code` missing 32.8%, `read_function` erroring 13.5%, and symbol lookups whiffing ~20%. Every failure class now has a recovery path.

Current candidate additions include a shared open-document snapshot path, consistent `.ctl` UserControl/`.dsr` limitation policy, focused provider regressions including cancellation-aware references, repository-external MCP cache defaults, deterministic Node 22/24 CI lanes, contributor/security intake documents, a checked-in marketplace icon and VSIX runtime-dependency/content guard, explicit single-root documentation, and bounded read-only `inspect_frx`/`inspect_res` MCP slices. The non-resource additions have compiled/protocol evidence from the maintainer gate; the resource source slices still need a fresh compiled MCP/package gate. Clean-install and real-project smoke remain open.

- **Argument aliases**: name-taking tools accept `symbol`/`routine`/`function`, file-taking tools accept `path`/`module`/`filename`, `search_code` accepts `text`/`pattern`/`q`. Previously `find_callers {symbol}` silently searched for `undefined`. Missing args in every spelling now return explicit `invalid_args` with `accepted_aliases`.
- **`Module.Proc` names**: `read_function`, `find_symbol`, `find_references`, call-graph and analysis tools strip trailing `()` and understand qualified names (`modShared.UseShared`).
- **Ambiguous filename auto-resolution**: duplicate basenames resolve via (1) the candidate containing the requested routine, (2) the candidate inside an explicitly configured source dir (`VB6_LSP_SOURCE_DIRS` beats Tools/MapEditor forks). True ties stay ambiguous, with ranked candidates capped at 10. Fuzzy basename matching handles missing extensions and odd casing.
- **`read_function` wrong-file recovery**: when the routine is missing from the named file but globally unique, its definition is served with a `resolution_note` instead of an error; multiple matches list the actual files.
- **`search_code` rescue pipeline**: scopes are normalized (backslashes, `./`), match as prefix or path segment (filenames work as scopes); zero hits fall back to all-tokens-on-one-line matching, then scope relaxation. `search_meta` reports `{stage, scopeRelaxed}`. Line normalization is now lazy (faster large-workspace scans).
- **Stale index recovery**: a long-lived server probes the snapshot (60s throttle) and rebuilds when files change; file lookups that miss but exist on disk trigger an immediate one-shot reindex — new modules are visible without manual `reindex_vb6`.
- **Zero-result suggestions everywhere**: `find_references`, `find_callers`/`find_callees`/`trace_*` (with `known_routine`), `signature`, `type_members`, `find_state_mutations`, `analyze_symbol`, `explain_symbol` return near-miss suggestions instead of bare empties.
- **Telemetry v4**: opt-in `VB6_LSP_TELEMETRY_CAPTURE_INPUTS` records raw text args (capped) on miss/error events only; default stays metadata-only.
- **New benchmark**: `npm run benchmark:rescue` replays the nine telemetry failure classes through the live server — 75/75 (100%) on the ImperiumAO workspace, gated at 95%. Predicates assert the CORRECT file and `resolution_note`, the backslash-scope category requires `scopeRelaxed === false`, and the gate fails when disambiguation categories produce no scenarios despite configured source dirs.
- **Resource inspection**: the source candidate adds `inspect_frx` for bounded read-only inspection of common `.frx`/`.ctx` short, medium, and long text, picture, font, and list records, plus `inspect_res` for standard `.res` entry metadata and `RT_STRING` values. Both reject unsafe paths and malformed/truncated input; resource writing and proprietary control bags are not claimed.

Post-release adversarial review (33-agent workflow) hardening:

- `read_function` with name only and multiple definitions now errors with all candidates instead of silently serving the first copy (the one critical finding).
- Filename matches in `search_code` are basename-only and emit one result per file — a path-flavored query can no longer flood results with a file's whole body.
- The directory the caller typed is now the STRONGEST disambiguation signal (`matches-request-path`): `AppB/modShared.bas` can never resolve to AppA because AppA is preferred.
- Fuzzy filename matching only auto-resolves exact normalized basenames; contains-matches are candidates only, so lookups for brand-new on-disk files reach the stale-index probe instead of being hijacked.
- Routine-containment ranking only counts real routines (Sub/Function/Property/Declare), not variables.
- The probe reindex skips files outside every indexed source dir (provably useless rebuilds) and the cooldown plus freshness interval are env-injectable (`VB6_LSP_PROBE_COOLDOWN_MS`, `VB6_LSP_FRESHNESS_INTERVAL_MS`).
- `batch_search_code` fallback sweeps share a 1.2s budget (`search_meta.budgetExhausted`), bounding the 4.2s worst case.
- Filenames passed as `name` ("modFoo.bas") return a clear `invalid_args` instead of searching for routine "bas"; `find_symbol` notes when a `Module.Proc` hint contradicts the actual module.
- Tests rewritten response-driven (no fixed sleeps — kills the startup race), covering ranking precedence conflicts, name-only duplicates, batch rescue, freshness rebuild, probe gating, cooldown, and telemetry error-path/truncation capture.
- Prior-suite result: retained only as historical context; the current maintainer-provided full suite is 63/63.

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
