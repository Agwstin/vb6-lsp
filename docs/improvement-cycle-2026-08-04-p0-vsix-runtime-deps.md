# Improvement cycle: VSIX runtime dependencies (2026-08-04)

## Failure signature

The extension and LSP entrypoints import unbundled runtime packages such as `vscode-languageclient`, `vscode-languageserver`, `vscode-uri`, and `chokidar`, while `.vscodeignore` excluded all of `node_modules`. A clean VS Code profile could install the VSIX but fail on activation because those modules were absent.

## Acceptance criterion

- `.vscodeignore` excludes development-only compiler/type directories but retains production runtime dependencies.
- `.vscodeignore` omits tests, development scripts, cycle notes, and issue templates from the install artifact while retaining README, changelog, license, runtime entrypoints, and the marketplace icon.
- The required transcompiled `shared/components.js` entrypoints are included in the package guard because both client/server output trees import the shared component policy.
- The MCP guard also names `out/mcp/mcp/frx.js` and `out/mcp/mcp/res.js`, so a future resource-tool build cannot be packaged while either imported module is absent.
- A read-only package-config check verifies that required entrypoints are not explicitly ignored and that runtime dependencies are installed before packaging; its `:built` variant also requires every compiled entrypoint.
- CI runs the package-config check after `npm ci`.
- `npm run package:vsix` invokes the built-output guard before `vsce` and therefore cannot create an artifact from stale output.
- The clean-profile VSIX installation and activation smoke remain a user-run gate.
- The first maintainer-produced VSIX exposed a packaging leak: telemetry
  archives, a machine-specific launch log/wrapper, and a build-only MCP config
  were included. Those paths are now explicitly ignored and guarded; the
  fresh 372-file package listing contains none of them.

## Verification layer

- Static: inspect source imports and ignore rules.
- Isolated: `npm run verify:package` prints the manifest/dependency checks without creating an artifact; `npm run verify:package:built` additionally checks the compiled entrypoints after the approved build.
- Packaging/runtime: the fresh `npm run package:vsix` completed with the
  required runtime files and no known non-runtime leaks. The clean VS Code
  profile smoke remains pending.
- The executable smoke checklist is [docs/clean-vsix-smoke.md](clean-vsix-smoke.md); it intentionally does not claim screenshots or activation evidence until run.

## Rollback boundary

Rollback is limited to `.vscodeignore`, the package-config verifier, its npm/CI entries, README packaging instructions, and this note. No runtime source behavior changes.
