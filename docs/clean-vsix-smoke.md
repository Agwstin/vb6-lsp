# Clean VSIX smoke test

This checklist is intentionally separate from source-level tests. It must be run after the approved build and package gates on a machine with VS Code installed.

## Prepare the artifact

From the repository root:

```powershell
npm ci
npm test
npm run verify:package:built
npm run package:vsix
```

Record the exact VSIX path printed by `vsce` and the output of each command. Do not assume a hand-written filename: the artifact name is derived from the extension metadata. Do not publish or commit the artifact.

Before installing, inspect the package listing. It must not contain
`telemetry/`, any `.log` file, `run-vb6-mcp.cmd`, `vb6-mcp-server.mjs`, or
`tsconfig.mcp.json`; those files can contain machine-specific paths or local
usage data. It should retain the compiled extension/LSP entrypoints and their
production `node_modules` dependencies.

## Use an isolated VS Code profile

Choose a temporary user-data directory and extensions directory outside the repository. Install the generated VSIX into that profile with the VS Code CLI, then launch the same profile. Keep the profile disposable so an existing extension or setting cannot mask activation failures.

## Observable checks

Open `tests/fixtures/sample-workspace` and verify:

1. `Client/source/modSample.bas` is recognized as Visual Basic 6.
2. Go to Definition on `UseShared` reaches `Common/modShared.bas`.
3. Find All References on `UseShared` returns the expected call and declaration behavior.
4. The VB6 status bar item reaches a completed indexing state without an error tooltip.
5. A known diagnostic in a temporary synthetic fixture appears with the expected range and message.
6. Opening a `.ctl` fixture starts the same language support and the component appears in project/MCP analysis.
7. The extension host log contains no missing-module error for `vscode-languageclient`, `vscode-languageserver`, `vscode-uri`, or `chokidar`.
8. The packaged MCP server's `tools/list` includes `inspect_frx` and
   `inspect_res`.
9. A packaged MCP call against the checked-in `.frx` fixture and an isolated
   standard `.res` fixture returns structured metadata without an `isError`
   response and without creating files inside the analyzed workspace.

The resource checks are package/protocol checks, not a claim that every
proprietary OCX control bag or designer payload is supported. Keep their
fixture and exact MCP response with the smoke evidence.

## Evidence to retain

Record the VS Code version, OS, Node version if applicable, VSIX filename, and exact pass/fail result for each check. Capture screenshots only from this real run:

- navigation/definition and references;
- diagnostic or refactor behavior;
- MCP analysis output.

A 30–45 second GIF may combine those real frames after the smoke passes. Do not use mock UI or claim a screenshot/GIF is validated before this checklist is complete.

## Cleanup

Close VS Code, remove only the temporary profile and generated VSIX if they are not intentionally being retained, and confirm the repository has no generated `out/`, cache, log, or VSIX changes beyond pre-existing files.
