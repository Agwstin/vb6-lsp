# Worktree inventory: 2026-08-04

This is a role-based inventory of the 91 dirty and untracked paths observed with
`git status --porcelain=v1 -uall` during the 3.4.0 improvement cycle. It is a
classification, not an ownership claim: existing worktree changes remain
untouched and no path is assumed to be safe to revert. The list is checked
against the status output whenever this inventory is updated.

## Product and runtime code

- `mcp-bridge.mjs`
- `src/client/extension.ts`
- `src/mcp/server.ts`
- `src/mcp/utils.ts`
- `src/server/config.ts`
- `src/server/documentStore.ts`
- `src/server/indexer/indexer.ts`
- `src/server/indexer/mcp-bridge.ts`
- `src/server/indexer/watcher.ts`
- `src/server/providers/codeActions.ts`
- `src/server/providers/diagnostics.ts`
- `src/server/providers/references.ts`
- `src/server/providers/rename.ts`
- `src/server/providers/semanticTokens.ts`
- `src/server/server.ts`
- `src/server/typeInference.ts`
- `src/server/telemetry.ts`
- `src/shared/components.ts`

## Regression coverage

- `tests/lsp.e2e.test.js`
- `tests/mcp-telemetry.test.js`
- `tests/mcp.test.js`
- `tests/project-reference-diagnostics.test.js`
- `tests/cache-policy.test.js`
- `tests/components.test.js`
- `tests/diagnostics.test.js`
- `tests/file-resolution-ranking.test.js`
- `tests/lsp-unsaved-buffer.test.js`
- `tests/mcp-rescue.test.js`
- `tests/multi-root-behavior.test.js`
- `tests/provider-cancellation.test.js`
- `tests/provider-matrix.test.js`

## Fixtures

- `tests/fixtures/advanced-workspace/App/Advanced.vbp`
- `tests/fixtures/advanced-workspace/App/source/frmMain.frm`
- `tests/fixtures/advanced-workspace/App/source/modTypes.bas`
- `tests/fixtures/advanced-workspace/App/source/modFormWith.bas`
- `tests/fixtures/code-actions-workspace/source/clsDuplicateMemberA.cls`
- `tests/fixtures/code-actions-workspace/source/clsDuplicateMemberB.cls`
- `tests/fixtures/code-actions-workspace/source/modEnumDiagnostics.bas`
- `tests/fixtures/code-actions-workspace/source/modMissingRoutine.bas`
- `tests/fixtures/component-workspace/App/Components.vbp`
- `tests/fixtures/component-workspace/App/source/DesignerOnly.dsr`
- `tests/fixtures/component-workspace/App/source/ucWidget.ctl`
- `tests/fixtures/project-scope-workspace/AppA/AppA.vbp`
- `tests/fixtures/project-scope-workspace/AppA/source/modShared.bas`
- `tests/fixtures/project-scope-workspace/AppB/AppB.vbp`
- `tests/fixtures/project-scope-workspace/AppB/source/modShared.bas`
- `tests/fixtures/project-scope-workspace/AppC/AppC.vbp`
- `tests/fixtures/project-scope-workspace/AppC/source/modSharedDuplicate.bas`

## Benchmark and telemetry tooling

- `scripts/benchmark-vs-grep.mjs`
- `scripts/benchmark-changes.py`
- `scripts/benchmark-core.mjs`
- `scripts/benchmark-rescue.mjs`
- `scripts/smoke-real-failures.mjs`
- `scripts/telemetry-deep.mjs`
- `scripts/telemetry-report.mjs`
- `src/mcp/telemetry.ts`

## Packaging, CI, and repository configuration

- `.gitattributes`
- `.github/workflows/ci.yml`
- `.gitignore`
- `.vscodeignore`
- `package.json`
- `package-lock.json`
- `images/icon.png`
- `scripts/generate-marketplace-icon.mjs`
- `scripts/verify-package-config.mjs`

## Documentation and contributor surface

- `IMPROVEMENT_LOOP.md`
- `README.md`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/compatibility_report.yml`
- `.github/pull_request_template.md`
- `docs/clean-vsix-smoke.md`
- `docs/improvement-cycle-2026-08-04-completion-audit.md`
- `docs/improvement-cycle-2026-08-04-p0-community-safety.md`
- `docs/improvement-cycle-2026-08-04-p0-inventory.md`
- `docs/improvement-cycle-2026-08-04-p0-marketplace-assets.md`
- `docs/improvement-cycle-2026-08-04-p0-vsix-runtime-deps.md`
- `docs/improvement-cycle-2026-08-04-p0.md`
- `docs/improvement-cycle-2026-08-04-p1-cancellation.md`
- `docs/improvement-cycle-2026-08-04-p1-ci-install.md`
- `docs/improvement-cycle-2026-08-04-p1-components.md`
- `docs/improvement-cycle-2026-08-04-p1-node-lts.md`
- `docs/improvement-cycle-2026-08-04-p1-provider-matrix.md`
- `docs/improvement-cycle-2026-08-04-p1-unsaved-buffers.md`
- `docs/improvement-cycle-2026-08-04-p2-cache.md`
- `docs/improvement-cycle-2026-08-04-p2-frx-design.md`
- `docs/improvement-cycle-2026-08-04-p3-performance-baseline.md`
- `docs/improvement-cycle-2026-08-04-p3-single-root.md`
- `docs/release-notes-3.4.0.md`

## Generated output and unrelated user work

The status inventory contained no tracked or untracked generated VSIX,
compiler output, cache, or log path created by this cycle. The ignored `out/`,
`node_modules/`, `.vb6-lsp-cache/`, and log paths were preserved and not
classified as deliverables. No path was classified as unrelated user work from
its name alone; provenance remains intentionally unresolved rather than being
used as permission to modify or delete it.
