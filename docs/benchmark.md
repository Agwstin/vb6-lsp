# Benchmark

This repository includes a reproducible benchmark script to compare `vb6-lsp` indexing/search operations against `git grep`.

Run it with:

```bash
npm run benchmark -- --root "C:/path/to/vb6-workspace" --source-dirs "src;forms;shared"
```

You can also write a Markdown snapshot:

```bash
npm run benchmark -- --root "C:/path/to/vb6-workspace" --source-dirs "src;forms;shared" --markdown-out docs/benchmark.md
```

## Snapshot

The table below was captured on a large real-world VB6 workspace with:

- 258 VB6 source files
- 54,114 indexed symbols

| Benchmark | vb6-lsp | git grep | Winner | Notes |
| --- | ---: | ---: | --- | --- |
| Index startup | 403.67 ms | n/a | grep | 258 files, 54114 symbols |
| Exact symbol lookup | 0.00 ms | 114.12 ms | lsp | module symbol |
| Reference search | 2.07 ms | 112.73 ms | lsp | common symbol |
| Scoped text search | 0.37 ms | 58.71 ms | lsp | scope=Server |
| Unscoped text search | 26.17 ms | 112.46 ms | lsp | workspace-wide |

## Interpretation

- `git grep` wins the startup cost because it does not build an index.
- After indexing, `vb6-lsp` is dramatically faster for repeated symbol and search workflows.
- Scoped and exact-match queries benefit the most from the indexed approach.
- In practical coding sessions, the index cost is usually amortized after only a handful of lookups.
