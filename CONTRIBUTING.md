# Contributing to vb6-lsp

Thanks for helping make VB6 navigation more reliable. The most useful contributions are small reproducible fixtures, documentation corrections, and compatibility reports from real `.vbp` projects.

## Before opening a change

- Read [README.md](README.md) and [IMPROVEMENT_LOOP.md](IMPROVEMENT_LOOP.md).
- Use Node.js 22 or newer.
- Preserve legacy VB6 line endings and project semantics; avoid repository-wide formatting.
- Never include proprietary source, credentials, tokens, customer names, or production paths in a fixture or issue.

## Local verification

Install deterministically and run the full repository gate from a clean working tree when possible:

```bash
npm ci
npm test
```

For a narrow change, also run the smallest relevant focused test and record the exact command and output. Separate evidence into:

1. static inspection or syntax checks;
2. isolated tests;
3. LSP/MCP protocol or end-to-end tests;
4. a real VB6 project or clean VSIX install.

Do not describe a static check as runtime validation. If the repository instructions prevent an agent from compiling, ask the maintainer to run the approved command and attach the complete output.

## Fixtures and pull requests

Reduce a real failure to the smallest lawful fixture before changing parsing or resolution behavior. State the expected symbol, diagnostic, navigation result, or MCP response. Keep generated `out/`, VSIX, caches, logs, and temporary files out of commits unless the change explicitly tests packaging.

Use the pull-request template and explain any behavior that is intentionally unsupported. Do not commit, tag, publish, push, or reply to an external issue on behalf of the maintainer without explicit authorization.
