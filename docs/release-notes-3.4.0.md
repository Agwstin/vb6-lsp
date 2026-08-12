# VB6 Language Server 3.4.0

`3.4.0` is published on GitHub Releases. Marketplace and Open VSX listings are not published yet.

## What changed

This candidate keeps the existing LSP and MCP analysis core and improves the MCP rescue path observed in the existing telemetry work:

- argument aliases and explicit missing-argument errors;
- qualified routine names such as `Module.Routine()`;
- ranked duplicate-file resolution, including wrong-file recovery when a routine is globally unique;
- scoped-search fallbacks with stage metadata;
- stale-index probes for new or changed files;
- near-miss suggestions for empty symbol and call-flow results;
- opt-in MCP and LSP telemetry with metadata-only defaults and miss/error input capture when explicitly enabled;
- a shared `.ctl` UserControl policy across project metadata, the LSP watcher/indexer, and MCP collection, with `.dsr` reported as unsupported;
- an open-document snapshot path for unsaved LSP buffers, including immediate index updates on `didOpen`, `didChange`, and `didSave` with disk convergence on `didClose`;
- a user-cache default for MCP index snapshots, with workspace-local caching retained only as an explicit opt-in;
- cache privacy, invalidation, retention, and manual-deletion guidance for those snapshots;
- a declared Node.js `>=22` runtime floor with Windows CI lanes for Node 22 and 24;
- a reproducible rescue benchmark and telemetry report scripts.
- a read-only core benchmark reporting cold/warm index and LSP/MCP request p50/p95 latency plus peak RSS.
- cancellation-aware reference scans that stop cleanly when the LSP request is cancelled.
- a packaging guard that retains unbundled runtime dependencies in the VSIX while excluding compiler/type-only directories and machine-specific telemetry/launch artifacts.
- a checked-in 128x128 PNG marketplace icon and manifest validation for its dimensions.
- the VSIX script now refuses to package until the compiled entrypoint guard passes.
- bounded, read-only `inspect_frx` and `inspect_res` MCP tools for common `.frm`/`.ctl` `.frx`/`.ctx` values and standard `.res` entry metadata/string tables; FRX short, medium, and long text framings are covered, unknown/vendor bags remain opaque, and resource writing is not included.

The candidate also adds regression fixtures for ranking, project references, form/member diagnostics, telemetry error paths, and MCP rescue behavior.

## Evidence boundaries

| Evidence | Status | Meaning |
| --- | --- | --- |
| Historical telemetry | 7,072 MCP calls | The rescue work was motivated by these existing observations; this is not a fresh measurement in this cycle. |
| Historical automated suite | 51/51 claimed in the existing worktree | Retained as historical context; the current maintainer-provided suite independently passes 71/71. |
| Current static inspection | Passed for this cycle | Version surfaces, repository links, release status, line-ending policy, component/provider/cache policy, package runtime dependency rules, and known whitespace were inspected; `git diff --check` exits 0. `npm run verify:package` passes, the package verifier now rejects known non-runtime leaks, and `npm audit --json` reports zero vulnerabilities. |
| Maintainer-provided pre-resource build/package gate | Build and package command completed; full suite is 63/63 | `npm test` compiled the required output and all 63 tests pass. The built package guard passed; the fresh 372-file VSIX listing retains the required runtime entrypoints/dependencies and excludes telemetry/log/launch files. |
| Current pre-resource focused isolated tests | 7/7 corrected regressions pass against compiled output | Cache policy, `.ctl` component policy, unsaved-buffer authority, and telemetry privacy/opt-in behavior pass after their test-only corrections. |
| Current resource isolated tests | 6/6 parser/IO tests plus packaged protocol checks pass | FRX reference, short/medium/long text, picture, and error checks plus RES record/string-table/path/null-header/oversize checks pass; packaged `tools/list` exposes both inspectors, FRX decodes, RES extracts a string, and the analyzed workspace remains unchanged. |
| Current isolated performance baseline | Passed on the checked-in advanced fixture | 9 files, 32 symbols; cold index p50/p95 2.110/4.261 ms; warm index 1.136/1.162 ms; LSP definition/references/completion and MCP references are recorded in [the cycle note](improvement-cycle-2026-08-04-p3-performance-baseline.md). Host-load-sensitive and not a real-project claim. |
| Current automated build/test | Passed from the maintainer-provided compiled gate | The returned `npm ci` has 0 vulnerabilities and the returned `npm test` compiled all trees with 71/71 passing; a direct no-build sweep also reports 71/71. |
| Real VB6 project validation | Passed locally on one project | A packaged LSP protocol pass against a local real-world `IAOSanitizer.vbp` indexed 46 files and 8,010 symbols, resolved `SanitizeMap`, reported no stderr errors, left the project root unchanged, and created no workspace cache. |
| Clean VS Code profile + VSIX install | Passed locally | A disposable VS Code 1.132.0 profile installed the 374-file `vb6-lsp-3.4.0.vsix`; definition and references worked in the sample workspace, and the extension host showed no missing-runtime-module error. The VSIX/profile were removed after the smoke. |

## Upgrade and installation

For the published artifact, use the [v3.4.0 GitHub Release](https://github.com/Agwstin/vb6-lsp/releases/tag/v3.4.0) and install its attached VSIX. For source development, follow the README setup steps and package locally. The release asset is the verified install path.

## Known limits

- The supported project model is VB6 `.vbp` with `.bas`, `.cls`, `.frm`, and text `.ctl` UserControl source files.
- This candidate does not claim full VB6 compiler, designer, COM metadata, VBA, or twinBASIC compatibility.
- Multi-root routing is explicitly single-root for this candidate: if a client sends multiple folders, the first is analyzed. Per-root routing and additional designer component types remain separate backlog items. Resource support is limited to the read-only `inspect_frx`/`inspect_res` slices described above; proprietary OCX bags, automatic designer hydration, and resource writing remain out of scope. Unsaved-buffer, `.ctl`/`.dsr` policy, provider-matrix, cache-location, package, resource protocol, and one real-project protocol gate have complete evidence; the dedicated diagnostic UI check remains open.
