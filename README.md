# VB6 Language Server

[![Version](https://img.shields.io/badge/version-2.1.1-1f6feb)](./package.json)
[![License](https://img.shields.io/badge/license-MIT-2da44e)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-14%20passing-2da44e)](./tests)

`vb6-lsp` is a Visual Basic 6 language server plus MCP server for real-world legacy VB6 codebases.

It understands multi-project `.vbp` workspaces, indexes large source trees quickly, and exposes the same VB6 analysis engine both to editors and to agent tooling.

## At a glance

| Surface | Use case | Includes |
| --- | --- | --- |
| `LSP` | editors and IDE workflows | definition, references, hover, completion, rename, diagnostics, member access, folding |
| `MCP` | agents and tool-driven workflows | symbol lookup, project info, code search, function reading, signatures, module summaries |

## Features

- `.vbp`-aware workspace discovery
- Go to definition
- Find references
- Hover
- Document symbols
- Workspace symbols
- Completion
- Signature help
- Rename
- Member access on typed variables and UDTs
- Folding ranges for multiline VB6 symbols
- Semantic tokens for indexed declarations
- Code actions for common diagnostics
- Diagnostics for missing block terminators, duplicate public symbols, and missing `Option Explicit`
- Basic type inference for common assignment patterns
- `.vbp` project metadata and external reference parsing
- Built-in stdio MCP server for indexed VB6 workflows

## Quick Start

```bash
git clone https://github.com/your-user/vb6-lsp.git
cd vb6-lsp
npm install
npm test
```

Run the LSP server:

```bash
npm run lsp:stdio
```

Run the MCP server:

```bash
npm run mcp:stdio
```

## Why LSP and MCP?

This project intentionally ships both:

- **LSP** is for editors. It powers interactive coding features like definition, hover, completion, rename, and diagnostics.
- **MCP** is for AI agents and other structured tooling. It exposes indexed operations like symbol lookup, references, code search, function reading, and module summaries.

They are not two separate analysis engines. Both are backed by the same VB6 parser, indexer, and symbol model.

## Workspace discovery

By default, `vb6-lsp`:

1. Uses the active workspace root.
2. Discovers `.vbp` files recursively.
3. Extracts source directories from `Module=`, `Class=`, `Form=` and related entries.
4. Merges any extra `vb6.sourcePaths` configured by the user.

Example settings:

```json
{
  "vb6.workspaceRoot": "C:/path/to/workspace",
  "vb6.projectFiles": ["ProjectA/App.vbp", "Shared/Library.vbp"],
  "vb6.sourcePaths": ["src", "shared", "legacy/forms"],
  "vb6.preferProjectFiles": true
}
```

## MCP tools

The built-in MCP server exposes:

- `find_symbol`
- `list_symbols`
- `find_references`
- `search_code`
- `read_function`
- `signature`
- `module_info`
- `project_info`
- `index_stats`
- `reindex_vb6`

The stdio MCP transport has been validated with both Codex and Claude Code.

## Benchmark

The repository includes a reproducible benchmark script:

```bash
npm run benchmark -- --root "C:/path/to/vb6-workspace" --source-dirs "src;forms;shared"
```

Example snapshot from a large real-world VB6 workspace:

| Benchmark | vb6-lsp | git grep | Winner |
| --- | ---: | ---: | --- |
| Index startup | 448.92 ms | n/a | grep |
| Exact symbol lookup | 0.00 ms | 122.17 ms | lsp |
| Reference search | 2.18 ms | 116.36 ms | lsp |
| Scoped text search | 0.54 ms | 67.00 ms | lsp |
| Unscoped text search | 36.20 ms | 122.96 ms | lsp |

Full benchmark notes: [docs/benchmark.md](docs/benchmark.md)

## Use with Codex

Example `~/.codex/config.toml` entry:

```toml
[mcp_servers.vb6-lsp]
command = "node"
args = ["C:/path/to/vb6-lsp/out/mcp/mcp/server.js"]
env = { VB6_LSP_ROOT = "C:/path/to/your/vb6-workspace" }
```

If you want to force specific project files or source directories:

```toml
[mcp_servers.vb6-lsp]
command = "node"
args = ["C:/path/to/vb6-lsp/out/mcp/mcp/server.js"]
env = { VB6_LSP_ROOT = "C:/path/to/workspace", VB6_LSP_PROJECT_FILES = "ProjectA/App.vbp;ProjectB/Tools.vbp", VB6_LSP_SOURCE_DIRS = "src;shared;forms" }
```

Codex compatibility note:

- validated against the built-in stdio MCP flow
- no extra wrapper is required beyond a working `node` executable in the environment

## Use with Claude Code

Example `~/.claude/mcpServers.json` entry:

```json
{
  "mcpServers": {
    "vb6-lsp": {
      "command": "node",
      "args": ["C:/path/to/vb6-lsp/out/mcp/mcp/server.js"],
      "env": {
        "VB6_LSP_ROOT": "C:/path/to/your/vb6-workspace"
      }
    }
  }
}
```

Claude Code note:

- if the MCP server does not appear after configuration changes, fully restart Claude Code
- on some Windows setups it can be more reliable to point the MCP config at an explicit `node.exe` path

## Example prompts

- `Find where ProcessOrder is defined and summarize what it does.`
- `List the public symbols in modInventory.bas.`
- `Find references to ApplyDamage.`
- `Read the full body of HandleConnection from clsSocketServer.cls.`
- `Show me the signature of WriteInteger.`
- `Summarize modCombat.bas before we change it.`
- `Search the VB6 codebase for MagicEffect in the server-side modules only.`

## Development

Common workflow:

```bash
npm install
npm run build:all
npm test
```

Useful scripts:

```bash
npm run build:all
npm run lsp:stdio
npm run mcp:stdio
npm run benchmark -- --root "C:/path/to/workspace" --source-dirs "src;forms;shared"
npm run package:vsix
npm test
```

Useful folders:

- `src/server/indexer/*` for parsing and indexing
- `src/server/providers/*` for LSP features
- `src/mcp/*` for MCP tools
- `tests/*` for automated validation

The repo also includes a VS Code launch configuration that starts an Extension Host against the fixture workspace in `tests/fixtures/sample-workspace`.

## Scope

`2.1.0` is intended to be a full-featured practical release for VB6 navigation and indexed code-exploration workflows:

- portable workspace discovery via `.vbp`
- project-wide symbol search and navigation
- contextual local/parameter-aware resolution for the main authoring features
- member access when the receiver type is known
- project/reference awareness from `.vbp`
- semantic tokens and basic quick fixes in the editor
- official stdio MCP server included in the repo

It is not a full VB6 compiler or full COM/type-inference engine.

## Validation

Automated tests cover:

- `.vbp` config discovery
- indexer behavior for module symbols, properties, locals, and parameters
- member access on class modules and UDT fields
- folding ranges for multiline VB6 symbols
- semantic tokens for indexed declarations
- code actions for common diagnostics
- project metadata and external reference parsing
- basic type inference from common assignments
- LSP end-to-end requests over stdio
- MCP stdio tool exposure, indexing, and richer tool workflows
