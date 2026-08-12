# Improvement loop completion audit

This audit is intentionally conservative. “Implemented” means the source,
fixtures, documentation, and evidence for the applicable verification rung are
present. The pre-resource compiled server and VSIX package have maintainer-provided
evidence; the new resource source modules still need a fresh generated-output
gate. Clean-profile and external-project validation remain separate.

| Requirement from `IMPROVEMENT_LOOP.md` | Current evidence | Status | Remaining proof or decision |
| --- | --- | --- | --- |
| Reconcile the 3.4.0 release surfaces | `package.json`, `package-lock.json`, LSP/MCP version, README, changelog, release notes | Pre-resource compiled 63/63 gate and package evidence present | Fresh resource build and clean install |
| Make the end-user install funnel honest | README install order, public-release boundary, sample workspace, upgrade/uninstall steps, compatibility matrix | Implemented statically | Clean-profile smoke |
| Keep VSIX runtime dependencies | `.vscodeignore`, `scripts/verify-package-config.mjs`, checked-in icon | Pre-resource built guard passed; fresh 372-file VSIX inspected with required runtime files retained and non-runtime exclusions clean | Fresh resource build and clean-profile install/activation |
| Make open buffers authoritative | `DocumentSnapshotStore`, `didOpen`/`didChange`/`didSave`/`didClose`, provider routing, protocol regression | Built output and complete 63/63 suite pass | Clean-profile smoke |
| Unify VB6 component policy | `src/shared/components.ts`, `.ctl` fixture, `.dsr` limitation, config/indexer/watcher/MCP usage | Built output, 63/63 suite, and fresh package check pass | Clean-profile smoke and real-project evidence |
| Cover advertised providers | `tests/provider-matrix.test.js`, cancellation test, existing provider tests | Complete compiled suite passes 63/63 | Clean-profile smoke and real-project evidence |
| Move MCP cache outside analyzed repositories | Cache root policy, privacy docs, stale/version/key tests | Complete compiled suite passes 63/63 | Real-project smoke |
| Decide multi-root behavior | README/release notes and `tests/multi-root-behavior.test.js` document first-folder single-root routing | Documented | User decision whether per-root routing is required |
| Measure before optimizing | Reproducible benchmark and isolated p50/p95/RSS baseline | Isolated evidence complete | Real-project baseline only if a lawful project is supplied |
| Investigate FRX/RES from issue #1 | `inspect_frx` and `inspect_res` read-only MCP slices, reviewable `.frm` + `.frx` fixture, bounded parser tests, and [design note](improvement-cycle-2026-08-04-frx-readonly-slice.md) | Source implemented; focused FRX proof 2/2 and RES proof 4/4 | Fresh MCP build/test, one real anonymized scenario, README/issue claim review |
| Build a real-world parser corpus | No proprietary or external failing construct supplied | Not started by design | Real anonymized failure fixture |
| Produce screenshots/GIF | Smoke checklist defines exact real interactions and capture boundary | Not produced | Clean VSIX smoke must pass first |
| Public release/community sequence | No commit, tag, publication, issue response, or community post performed | Authorization pending | Maintainer approval plus verified artifact and channel decisions |

## Current verification ladder

- Static: `npm run verify:package`, syntax checks, and `git diff --check` pass; `npm audit --json` now reports zero vulnerabilities after compatible transitive updates.
- Isolated: the corrected cache, component, unsaved-buffer, and telemetry regressions pass 7/7 against the compiled output; the first complete maintainer run was 59/63 before those test corrections.
- Build/protocol: the maintainer-provided pre-resource `npm test` output compiled all trees successfully and passes 63/63; focused source resource tests are tracked separately below.
- Artifact: the pre-resource `npm run verify:package:built` passed and the fresh 372-file VSIX listing retains required runtime files while excluding telemetry/log/launch/config leaks; the package guard now waits for the two new resource modules in the next build.
- Real use: the VSIX artifact boundary is verified, but no clean VS Code profile or external `.vbp` project is claimed as validated.

## Verification performed during the 2026-08-12 continuation

- `npm run verify:package` passed in the current source state.
- The earlier pre-resource `npm run verify:package:built` passed with `built_output_verified: true`; after adding the resource modules, the current rerun correctly stops until `out/mcp/mcp/frx.js` and `out/mcp/mcp/res.js` exist.
- JavaScript syntax checks passed for the repository's `.js`/`.mjs` tooling files.
- All 32 pre-resource test files were executed directly against the existing compiled output: **63/63 tests passed**. The focused unsaved-buffer protocol regression passed, as did the LSP E2E and all MCP protocol regressions; the two new resource test files are tracked separately below.
- The repository's `node --test` worker mode cannot be used in the managed sandbox: it fails before loading tests with `spawn EPERM`. This is an environment limitation; it is not recorded as a test assertion failure.
- `git diff --check` reported no whitespace errors; Git emitted only the existing mixed-EOL normalization warnings.
- The earlier pre-resource `npm run package:vsix` produced a disposable 372-file `vb6-lsp-3.4.0.vsix`. An isolated VS Code 1.132.0 profile installed it as `vb6lsp.vb6-lsp@3.4.0`; opening the sample workspace together with `modSample.bas` activated `onLanguage:vb6` and logged `VB6 LSP: Indexed 7 symbols from 2 files (2 source dirs)`. No missing-runtime-module matches were found in the extension-host logs. The generated VSIX and temporary profile were deleted after the smoke.
- GUI-only navigation clicks, diagnostic rendering, and `.ctl` visual interaction remain unclaimed; the corresponding LSP/MCP protocol and component regressions are covered by the 63/63 test run.
- The new resource source slices were verified directly with `node tests/frx.test.js` (**2/2 focused parser tests passed**, including short/medium/long text and the bounded medium-record length correction; its post-build MCP protocol test was correctly skipped because the existing `out/mcp` tree predates the resource tools) and `node tests/res.test.js` (**4/4 parser/IO tests passed**, including the standard null-header and zero-based `RT_STRING` checks plus the oversized truncation signal, with its post-build MCP protocol test skipped for the same reason). TypeScript transpile syntax checks passed for `src/mcp/frx.ts`, `src/mcp/res.ts`, and the edited MCP server; no generated output was written.
- A direct no-build sweep executed all **34** JavaScript test files currently under `tests/`; **71** test cases reported 69 passes, 0 failures, and 2 intentional protocol skips, and every process exited 0. This is supplemental evidence only: most existing tests load the stale pre-resource `out/` tree, while the two resource files use their source-transpile fallback. It does not replace the maintainer-run `npm test` gate.
- Both direct parser APIs now enforce the same 64 MiB input boundary as their file-inspection wrappers; random malformed-buffer sweeps remain safe (1,000 FRX plus 1,000 RES calls, no throws).
- In-memory malformed-input sweeps returned safely for 1,000 random FRX buffers and 1,000 random RES buffers; no parser invocation threw or allocated a generated artifact.
- The FRX fixture is intentionally a reviewable short-string record. `.res` is now metadata/string-table read-only only; proprietary OCX bags, binary resource writing, and automatic designer hydration remain explicitly unimplemented.
- `npm run benchmark:core -- --root tests/fixtures/advanced-workspace --source-dirs App/source --iterations 5` passed as a read-only measurement: 9 files, 32 symbols; cold index p50/p95 2.110/4.261 ms; warm index 1.136/1.162 ms; LSP definition 0.034/0.923 ms; references 0.673/1.128 ms; completion 0.015/0.310 ms; MCP references 0.014/0.206 ms; peak RSS 53.789 MB.
- The package guard now explicitly requires the generated `out/mcp/mcp/frx.js` and `out/mcp/mcp/res.js` files. `npm run verify:package` passes statically; `npm run verify:package:built` correctly stops with those two missing files until the approved MCP build is run.
- No commit, tag, release, marketplace publication, GitHub issue response, or community post was performed.

## Exact next gate

The existing 3.4.0 build/package gate is complete for the earlier source state,
but the resource source slices now need a fresh maintainer-run `npm test`,
package verification, and clean VSIX smoke so the generated MCP output
contains `inspect_frx` and `inspect_res`. Record the VS Code version, OS, Node
version, artifact path, and each pass/fail observation. Do not publish, commit,
or reply to external issues as part of that verification.
