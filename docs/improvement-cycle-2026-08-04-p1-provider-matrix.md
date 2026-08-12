# Improvement cycle: P1 provider-matrix coverage (2026-08-04)

## Scope

Close the focused-test gap for advertised LSP providers: hover, signature help, rename/prepare-rename safety, workspace-symbol filtering, and the unresolved-routine stub code action. This cycle adds regression coverage only; it does not change provider behavior, dependencies, packaging, multi-root routing, or MCP cache storage.

## Failure signature and cheapest evidence

The repository has isolated tests for completion, diagnostics, semantic tokens, and some code actions, but no focused failure signal for several README-advertised providers. A behavior regression in those handlers could therefore pass the existing isolated suite until a client exercises the protocol. The cheapest discriminating evidence is a fixture-backed handler test using the already-built `out/` artifacts; the complete protocol gate still requires the user-run build/test command.

## Acceptance criterion

One focused test file must prove, against the advanced/code-action fixtures:

- hover returns a VB6 signature and source location;
- signature help resolves the active parameter and parameter labels;
- prepare-rename returns the exact identifier range, rename returns exact edits, and ambiguous public definitions are rejected;
- workspace symbols honor the query, omit local-scope symbols, and surface duplicate public definitions instead of silently choosing one;
- an unresolved-routine diagnostic offers the named stub action.

The test must pass against the current compiled implementation and remain runnable by `npm test` after the user rebuilds `out/`.

## Verification layer

- Static: JavaScript syntax parse, fixture/path inspection, `git diff --check`.
- Isolated: `node --test tests/provider-matrix.test.js` against the existing `out/` directory.
- Protocol/suite: pending the user's approved `npm test` gate; no server compilation is run by this agent.
- Real project: out of scope for this cycle.

## Discarded alternatives

- Adding production behavior without a failing provider-specific test was discarded because the backlog item is test-matrix closure, not a speculative provider rewrite.
- Reusing the LSP end-to-end test alone was discarded because it does not isolate hover, signature-help, rename safety, workspace-symbol scope, or stub-action failures.

## Rollback boundary

Rollback is limited to the new cycle note and `tests/provider-matrix.test.js`; no pre-existing dirty file is reverted.
