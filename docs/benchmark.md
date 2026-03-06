# Benchmark

Workspace: user-provided VB6 workspace

Files indexed: **258**

Symbols indexed: **59235**

| Benchmark | vb6-lsp | git grep | Winner | Notes |
| --- | ---: | ---: | --- | --- |
| Index startup | 448.92 ms | n/a | grep | 258 files, 59235 symbols |
| Exact symbol lookup | 0.00 ms | 122.17 ms | lsp | module symbol |
| Reference search | 2.18 ms | 116.36 ms | lsp | common symbol |
| Scoped text search | 0.54 ms | 67.00 ms | lsp | scope=Server |
| Unscoped text search | 36.20 ms | 122.96 ms | lsp | workspace-wide |
