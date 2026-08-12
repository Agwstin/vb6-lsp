# Improvement cycle: cancellable long reference requests (2026-08-04)

## Failure signature

The advertised provider matrix covered references but did not prove what happens when an editor cancels a potentially long reference scan. The LSP connection receives a cancellation token, but the provider ignored it and continued scanning every target.

## Acceptance criterion

Reference requests must return `null` without reading further source when their cancellation token is already cancelled, and must check the token between files and lines during a scan. The focused regression covers both a pre-cancelled request and cancellation arriving after the first source read. The server must forward the LSP token to the provider. Existing non-cancelled reference behavior remains unchanged.

## Verification layer

- Static: inspect the provider/server forwarding and parse the new test.
- Isolated regression: `provider-cancellation.test.js` must fail against stale `out/` and pass after the user rebuilds it.
- Protocol: the full `npm test`/LSP gate remains user-run because this repository does not allow the agent to compile the server.

## Discarded alternatives

- Returning partial locations on cancellation was rejected because the current handler does not advertise a partial-result channel; `null` is the existing LSP no-result shape.
- Adding cancellation checks only in the server wrapper was rejected because synchronous provider work would already have run.

## Rollback boundary

Rollback is limited to the references provider, its server call site, the focused regression, and this note. No index or parser behavior changes.
