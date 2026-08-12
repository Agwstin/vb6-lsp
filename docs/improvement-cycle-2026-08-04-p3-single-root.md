# Improvement cycle: document single-root behavior (2026-08-04)

## Scope

Document and regression-test the current workspace routing boundary without implementing multi-root indices. `resolveWorkspaceConfig` selects `rootUri` when provided, otherwise the first entry in `workspaceFolders`; the LSP server builds one index and one project configuration from that root.

## Failure signature and cheapest evidence

The public compatibility text did not explicitly state what happens when a client sends multiple workspace folders. A user could reasonably expect per-root routing while the server silently analyzes only one. The cheapest evidence is a config-level test passing two folders and asserting that the first folder is selected.

## Acceptance criterion

- README and release notes state that multi-root routing is not implemented and the first workspace folder is used.
- The focused test proves the current selection order and does not alter project discovery.

## Verification layer

- Static: source/config inspection, JavaScript syntax parse, `git diff --check`.
- Isolated: `node --test tests/multi-root-behavior.test.js`.
- Protocol/real multi-root: out of scope until the user decides this is a required feature.

## Rollback boundary

Rollback is limited to this note, the compatibility wording, and the focused test. No routing code is changed.
