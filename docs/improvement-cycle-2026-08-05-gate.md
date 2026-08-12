# Improvement cycle gate follow-up (2026-08-05)

> Historical pre-resource gate. The later `inspect_frx`/`inspect_res` source
> modules require a fresh build/package run; see the current
> [completion audit](improvement-cycle-2026-08-04-completion-audit.md).

The maintainer returned the first Windows release-gate output after the source
cycle changes. This note separates what that output proves from the local
follow-up checks and the remaining user-run artifact smoke.

## Maintainer-provided gate

The returned commands were:

- `npm ci`: completed on Node/npm with 31 audited packages; it initially
  reported two high-severity transitive advisories.
- `npm test`: compiled all three TypeScript trees successfully, then reported
  59 passing and 4 failing tests.
- `npm run verify:package:built`: passed and reported `built_output_verified`.
- `npm run package:vsix`: produced a local `vb6-lsp-3.4.0.vsix`.

The four failures were deterministic test/fixture assumptions, not four
distinct runtime regressions:

| Test | Cause | Follow-up |
| --- | --- | --- |
| `cache-policy.test.js` | ignored fixture cache copied into the temporary workspace | fixture copy now filters `.vb6-lsp-cache` |
| `components.test.js` | Windows path/case assertion assumed POSIX casing | assertions now normalize separators and case |
| `lsp-unsaved-buffer.test.js` | equivalent `file:` URIs differed in drive-letter escaping/case | assertions now compare decoded normalized filesystem paths |
| `mcp-telemetry.test.js` | inherited raw-input environment made the privacy-default test nondeterministic | privacy test explicitly sets `VB6_LSP_TELEMETRY_CAPTURE_INPUTS=0` |

The focused rerun against the compiled output passed all 7 test cases:

```text
node --test tests/cache-policy.test.js tests/components.test.js \
  tests/lsp-unsaved-buffer.test.js tests/mcp-telemetry.test.js
7 pass, 0 fail
```

The dependency audit was also remediated without a major-version upgrade:
`brace-expansion` moved from `2.0.2` to `2.1.4`, and `picomatch` from `2.3.1`
to `2.3.2`. A fresh `npm audit --json` reports zero vulnerabilities.

## Second gate returned by the maintainer

The follow-up output is green:

- `npm ci`: completed with 0 vulnerabilities.
- `npm test`: compiled all trees and passed **63/63** tests.
- `npm run verify:package:built`: passed with `built_output_verified: true`.
- `npm run package:vsix`: produced `vb6-lsp-3.4.0.vsix` with 372 files.

The generated VSIX was inspected directly. It has no telemetry directory,
logs, machine-specific launch wrappers, `tsconfig.mcp.json`, or `ROADMAP.md`,
while retaining the client/server/MCP entrypoints, language configuration,
grammar, and all five production runtime dependency roots.

## VSIX content finding

The first package listing showed the extension contained `telemetry/` (32.21
MB), `vb6-mcp-launch.log`, `run-vb6-mcp.cmd`, `vb6-mcp-server.mjs`, and
`tsconfig.mcp.json`. The launch files contain machine-specific workspace paths
and telemetry locations; they are not extension runtime entrypoints.

`.vscodeignore` now excludes those files, telemetry archives, root logs, and
`ROADMAP.md`. `scripts/verify-package-config.mjs` checks both that required
runtime files are retained and that these non-runtime paths are ignored. The
fresh 372-file VSIX listing confirms the correction.

## Third gate returned by the maintainer (2026-08-12)

The latest Windows run was made against the resource-aware source and is the
current proof for the compiled build:

- `npm test`: compiled all three TypeScript trees and passed **71/71** tests
  (`0` failures, `0` skips).
- The suite included both FRX protocol coverage and RES protocol coverage,
  plus unsaved-buffer, component-policy, cancellation, provider, cache, and
  telemetry regressions.
- `npm run verify:package:built`: passed with
  `built_output_verified: true`; the manifest retained the client/server/MCP
  entrypoints, `inspect_frx`/`inspect_res` output, language assets, and
  production runtime dependencies.

This supersedes the earlier 63/63 source-cycle count for the current resource
implementation. It does not by itself prove `npm ci` in this run, a newly
produced VSIX, a clean-profile VS Code install, or validation against an
external real-world `.vbp` project.

## Fourth gate completed locally (2026-08-12)

The packaged-output and isolated-profile checks were then run without changing
the pre-existing working tree:

- `npm ci`: exit `0`; 30 packages added, 31 audited, 0 vulnerabilities.
- `npm audit --json`: `0` info, low, moderate, high, and critical
  vulnerabilities.
- `node scripts/run-tests.mjs` against the already-built output: **71/71**
  passed, `0` failed, `0` skipped.
- `npm run verify:package` and `npm run verify:package:built`: both passed.
- `npm run package:vsix`: produced `vb6-lsp-3.4.0.vsix` with 374 files
  (603.34 KB). An archive listing found 0 forbidden telemetry/log/launch/
  build-config entries and retained the client, LSP, MCP, FRX, and RES runtime
  entrypoints.
- VS Code `1.132.0` installed the VSIX into a disposable profile as
  `vb6lsp.vb6-lsp@3.4.0`. Opening the sample workspace and `modSample.bas`
  activated the extension; the extension-host log contained no extension-
  specific error/warning or missing-runtime-module line.
- The packaged LSP protocol against `tests/fixtures/sample-workspace` indexed
  2 files, returned 1 `SharedValue` workspace symbol, resolved definition to
  `Common/modShared.bas`, and returned 2 references, with no stderr error.
- The packaged LSP protocol against `tests/fixtures/component-workspace`
  indexed `ucWidget.ctl` and found `Ping` in that `.ctl`, with no stderr error.
- A packaged MCP call listed both `inspect_frx` and `inspect_res`, decoded the
  checked-in FRX fixture, extracted `From packaged MCP` from an isolated RES
  fixture, returned no `isError`/`Unhandled`, and left the analyzed workspace
  directory unchanged.

The isolated VS Code UI pass then opened the sample workspace with the status
bar showing `Visual Basic 6` and `No Problems`. Selecting `UseShared` and
running Go to Definition navigated to `Common/modShared.bas`; running Go to
References returned to the sample call-site and announced the matching symbol
in the editor. The known diagnostic still needs its dedicated UI check, and
these checks do not constitute validation against an external real-world
`.vbp` project.

A separate packaged LSP protocol pass used one real `.vbp` project outside this
checkout (`IAOSanitizer`). It indexed 46 files and 8,010 symbols across one
project with three external references, found `SanitizeMap`, and resolved its
definition back to the source module without stderr errors. The project root
entries were unchanged, no `.vb6-lsp-cache` appeared there, and the temporary
user-cache directory was removed after the run.

## Remaining evidence

The remaining evidence is the known-diagnostic UI check described in
[`docs/clean-vsix-smoke.md`](clean-vsix-smoke.md). No publication, issue reply,
or commit is authorized by this note.
