# Improvement cycle: reproducible performance baseline (2026-08-04)

## Scope

Add a read-only benchmark for the P3 measurement requirement. It reports corpus size, cold and warm index builds, LSP definition/references/completion, representative MCP reference analysis, p50/p95 latency, result counts, and peak RSS. It does not optimize synchronous filesystem work or implement multi-root routing.

## Failure signature and cheapest evidence

The existing `benchmark-vs-grep.mjs` reports an average for index/search comparisons, but it does not provide p50/p95 or cover the advertised LSP request mix and a representative MCP analysis. Without those numbers, a performance change would be speculative. The cheapest evidence is a standalone benchmark over the public fixture using the already-compiled modules.

## Acceptance criterion

`npm run benchmark:core -- --root tests/fixtures/advanced-workspace --source-dirs App/source` emits machine-readable JSON containing:

- file/symbol corpus size;
- cold and warm index measurements;
- definition, references, completion, and MCP analysis measurements;
- p50/p95 latency and peak RSS.

The command is read-only and leaves no cache, VSIX, log, or result file unless the caller redirects stdout explicitly.

## Isolated baseline captured (refreshed 2026-08-12)

Command:

```text
node scripts/benchmark-core.mjs --root tests/fixtures/advanced-workspace --source-dirs App/source --iterations 5
```

Observed on the current Windows checkout using the pre-existing `out/` modules:

| Operation | p50 | p95 | Result count |
| --- | ---: | ---: | ---: |
| Cold index | 2.110 ms | 4.261 ms | 32 symbols |
| Warm index | 1.136 ms | 1.162 ms | 32 symbols |
| LSP definition | 0.034 ms | 0.923 ms | 1 |
| LSP references | 0.673 ms | 1.128 ms | 1 |
| LSP completion | 0.015 ms | 0.310 ms | 1 |
| MCP find references | 0.014 ms | 0.206 ms | 1 |

Corpus: 9 files and 32 symbols. Peak RSS: 53.789 MB. Timings are host-load-sensitive and are a recorded isolated baseline, not a real-project performance claim.

## Verification layer

- Static: JavaScript syntax parse and source inspection.
- Isolated: run against the public fixture and inspect JSON shape/finite metrics.
- Full real-project baseline: pending a user-provided non-proprietary workspace.

## Rollback boundary

Rollback is limited to the benchmark script, its npm entry, and this note. No production provider or index behavior is changed.
