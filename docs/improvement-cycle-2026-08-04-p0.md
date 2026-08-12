# Improvement cycle: P0 release consistency (2026-08-04)

## Scope

Stabilize the existing unreleased 3.4.0 work only. This cycle covers repository-internal version consistency, README trust corrections, release-note evidence boundaries, deliberate line-ending rules, and the known trailing-whitespace defect in the advanced form fixture.

Explicitly out of scope: new analysis features, unsaved-buffer authority, component expansion, CI/build changes, VSIX publication, marketplace/Open VSX publication, commits, pushes, and external messages.

## Proof before code

- Failure signature: package metadata and MCP report 3.4.0 while the lockfile, LSP server, and README still identify 3.3.2; the README clone URL points at `your-user`; the test badge says 26 although the candidate changelog claims 51; `git diff --check` reports trailing whitespace in `frmMain.frm`.
- Cheapest discriminating evidence: repository search, `git diff --stat`, `git diff --check`, and `git ls-files --eol`.
- User-visible acceptance: every local release surface identifies the same 3.4.0 candidate, unpublished status is explicit, the clone/install instructions point to `Agwstin/vb6-lsp`, no stale numeric test badge remains, and `git diff --check` is clean.
- Required verification layers: static inspection now; the full build/test suite and clean-profile VSIX smoke test require a user-run gate because repository instructions prohibit this agent from running server compilation or `npm test`.
- Rollback boundary: only the files listed below may change; all pre-existing dirty product, test, fixture, benchmark, and telemetry changes remain intact.

## Intended files

- `package.json`, `package-lock.json`, `src/server/server.ts`
- `README.md`, `CHANGELOG.md`, `docs/release-notes-3.4.0.md`
- `.gitattributes`, `tests/fixtures/advanced-workspace/App/source/frmMain.frm`
- this cycle note

## Evidence status

Historical telemetry and the existing 51/51 claim are documented as historical evidence, not as current verification. Static verification passed; current automated and clean-install verification remain pending the user-run gate.
