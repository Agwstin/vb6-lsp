# VB6 Language Server

[![Version](https://img.shields.io/badge/version-3.4.0-2ea043)](./package.json)
[![License](https://img.shields.io/badge/license-MIT-2da44e)](./LICENSE)
[![CI](https://github.com/Agwstin/vb6-lsp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Agwstin/vb6-lsp/actions/workflows/ci.yml)

`vb6-lsp` is a Visual Basic 6 language server plus MCP server for real-world legacy VB6 codebases.

It understands multi-project `.vbp` workspaces, indexes large source trees quickly, and exposes the same VB6 analysis engine both to editors and to agent tooling.

## At a glance

| Surface | Use case | Includes |
| --- | --- | --- |
| `LSP` | editors and IDE workflows | definition, references, hover, completion, rename, diagnostics, member access, folding |
| `MCP` | agents and tool-driven workflows | symbol lookup, bundled analysis, project info, resource inspection, call graph tracing, state mutations, summaries |

## Why vb6-lsp?

Visual Basic 6 tooling often understands isolated files but loses the project
relationships that make a legacy system navigable. `vb6-lsp` is built around
real `.vbp` workspaces:

- one project-aware index powers both editor features and MCP tools;
- definition, references, diagnostics, and agent analysis work across source
  directories and project references; and
- resource inspection is read-only and explicit about what is understood,
  instead of pretending to be a full VB6 compiler, designer, or COM type system.

Best fit: developers maintaining old VB6 applications and agents helping them
understand unfamiliar legacy code. It is not a VBA, VB.NET, twinBASIC, or
drop-in replacement for the VB6 IDE.

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
- Member access inside `With` blocks
- Folding ranges for multiline VB6 symbols
- Semantic tokens for declarations and symbol usages
- Code actions for common diagnostics
- Diagnostics for missing block terminators, duplicate public symbols, and missing `Option Explicit`
- Diagnostics for unresolved routines
- Diagnostics for unresolved `With` receivers
- Diagnostics for missing external project references
- Basic type inference for common assignment patterns
- `.vbp` project metadata and external reference parsing
- Basic `.frm` designer/control awareness
- Built-in stdio MCP server for indexed VB6 workflows
- Agent-first analysis tools for explanations, call flow, mutations, and entrypoints
- Specialized workflows for packet handlers and UI forms
- Bundled analysis tools for single-call symbol/module investigation
- Read-only inspection of common `.frm`/`.ctl` `.frx`/`.ctx` companion references through MCP
- Read-only inspection of standard Windows `.res` entries and string tables through MCP

## Install

`3.4.0` is the latest GitHub release. Download the VSIX from the [v3.4.0 release page](https://github.com/Agwstin/vb6-lsp/releases/tag/v3.4.0) and install it with `code --install-extension <downloaded-vsix>`. Marketplace and Open VSX listings are not published yet.

For source development or a local build:

The source setup requires Node.js 22 or newer. CI exercises Node.js 22 and 24 on Windows.

```bash
git clone https://github.com/Agwstin/vb6-lsp.git
cd vb6-lsp
npm ci
npm run build:all
```

To package the local extension for VS Code:

```bash
npm run package:vsix
# Replace <generated-vsix-path> with the exact .vsix path printed by vsce.
code --install-extension <generated-vsix-path>
```

The VSIX keeps the unbundled production runtime dependencies required by the extension and LSP. Check that packaging inputs are present before creating the artifact:

```bash
npm run verify:package
```

After `npm test` has produced the compiled `out/` tree, use the stronger artifact gate:

```bash
npm run verify:package:built
```

`npm run package:vsix` runs the strong compiled-output guard before invoking `vsce`, so it refuses to create an artifact from stale or incomplete `out/` files. The published 3.4.0 package contains the required runtime files without local telemetry/launch files and was installed in a disposable VS Code profile; see [the gate follow-up](docs/improvement-cycle-2026-08-05-gate.md).

The exact clean-profile checklist, acceptance observations, and screenshot/GIF capture boundary are in [docs/clean-vsix-smoke.md](docs/clean-vsix-smoke.md).

To upgrade a locally installed VSIX, package the newer candidate and repeat `code --install-extension <file>.vsix --force`. To uninstall the extension, run `code --uninstall-extension vb6lsp.vb6-lsp`.

## Quick Start

1. Open `tests/fixtures/sample-workspace` as a VS Code workspace.
2. Open `Client/source/modSample.bas` and invoke **Go to Definition** on `UseShared`.
3. Invoke **Find All References** on `UseShared`; the result should include `Common/modShared.bas`.

The sample is intentionally small and public. Use a real `.vbp` workspace after this first navigation check.

## Support and contributions

Use the [bug report](https://github.com/Agwstin/vb6-lsp/issues/new?template=bug_report.yml) for reproducible defects and the [VB6 compatibility report](https://github.com/Agwstin/vb6-lsp/issues/new?template=compatibility_report.yml) for anonymized results from real projects. Do not attach proprietary source, credentials, tokens, customer names, or production paths; see [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) first.

## Compatibility and limits

| Target | Current claim |
| --- | --- |
| Visual Basic 6 | `.vbp` project discovery and analysis for `.bas`, `.cls`, `.frm`, and text `.ctl` UserControls are the supported path. |
| Resource companions | MCP-only read-only inspection for common `.frx`/`.ctx` values and standard `.res` entry metadata/`RT_STRING`; no resource writing or full designer hydration. |
| VBA projects | Not a supported project model; overlapping syntax may work by coincidence only. |
| twinBASIC | Not validated or advertised as compatible. |
| LSP clients | The VS Code extension and stdio LSP are the maintained paths; other clients must support the advertised LSP capabilities. |
| Operating systems | Windows is the verified CI path; other operating systems are not currently claimed as clean-install validated. |
| Workspace roots | Single-root behavior: when multiple workspace folders are sent, the first folder is analyzed. Per-root routing is not implemented. |
| Compiler/designer/COM | This is navigation and analysis, not a full VB6 compiler, designer host, or COM type system. |

## Run the servers

After building from source, run the LSP server:

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
- `list_projects`
- `reference_info`
- `type_members`
- `explain_symbol`
- `find_callers`
- `find_callees`
- `trace_flow`
- `find_related_symbols`
- `find_state_mutations`
- `find_network_entrypoints`
- `find_ui_entrypoints`
- `summarize_module`
- `analyze_packet_handler`
- `analyze_ui_form`
- `analyze_symbol`
- `analyze_module`
- `trace_inbound_flow`
- `trace_outbound_flow`
- `analyze_state_symbol`
- `analyze_startup_flow`
- `analyze_project_reference_impact`
- `index_stats`
- `reindex_vb6`
- `inspect_frx`
- `inspect_res`

The stdio MCP transport has been validated with both Codex and Claude Code.

### FRX companion inspection (source candidate)

The `inspect_frx` MCP tool accepts a `.frm` or `.ctl` file plus the raw VB6
reference value (for example, `"Form1.frx":0000` or `$"Form1.frx":0004`). The
first read-only slice understands:

- short, medium (`FF + uint16`), and long length-prefixed text values;
- standard `StdPicture` framing with image-format metadata and a bounded hex preview;
- standard `StdFont` metadata; and
- list records with bounded item counts;
- Windows-1252 text decoding for the byte-oriented text path.

Unknown/vendor control bags are returned as bounded `opaque` previews. Invalid
offsets, truncated records, oversized companions, and paths outside the
workspace fail explicitly. It does not write any resource, and does not claim
to decode proprietary OCX bags or make the VS Code designer render binary
resources automatically.

The `inspect_res` MCP tool reads standard Windows resource records without
returning their full binary payload. It reports type/name/language/header/data
metadata, a bounded hex preview, and extracts non-empty values from standard
`RT_STRING` tables using the Windows block/index ID convention. It rejects
malformed/truncated records, unsafe workspace
paths, and oversized files. It does not write `.res` files or decode every
resource-specific payload (menus, dialogs, icons, version blocks, and custom
types remain metadata/preview only).

### Agent-rescue behaviors (3.4.0)

The tool layer is designed so an agent's first attempt almost always produces something useful:

- **Argument aliases** — `name` also accepts `symbol`/`routine`/`function`, `file` accepts `path`/`module`/`filename`, `query` accepts `text`/`pattern`/`q`. A missing argument in every spelling returns `invalid_args` with `accepted_aliases`.
- **Qualified names** — `Module.Routine` and trailing `()` are understood by `read_function`, `find_symbol`, `find_references`, and the call-graph tools.
- **Ambiguous filenames auto-resolve** — duplicate basenames pick the copy that contains the requested routine, then the copy inside an explicitly configured source dir (`VB6_LSP_SOURCE_DIRS`). Auto-resolutions carry `resolution_note` and `alternates`; true ties stay errors with ranked candidates.
- **Wrong-file recovery** — `read_function` serves a globally unique routine even when the file hint is wrong, with a `resolution_note`.
- **Search fallbacks** — scopes are slash-normalized and match as prefix or path segment (a filename works as a scope); zero hits fall back to all-tokens-on-one-line matching, then scope relaxation. `search_meta` reports which stage produced the results.
- **Stale-index recovery** — the long-lived server re-checks the file snapshot (throttled) and force-reindexes once when a requested file exists on disk but is missing from the index.
- **Suggestions on empty** — zero-result symbol lookups return ranked near-miss suggestions instead of bare empties; call-graph tools add `known_routine`.

## Telemetry

The MCP server and LSP server support **local, opt-in telemetry** for measuring real-world tool and editor-provider usage.

Enable it with environment variables:

```bash
VB6_LSP_TELEMETRY_ENABLED=true
VB6_LSP_TELEMETRY_DIR=/path/to/telemetry
```

It writes JSONL events to `mcp-usage.jsonl` and `lsp-usage.jsonl` with non-sensitive metadata such as:

- schema version
- server version
- session ID and request ID
- tool name
- duration
- result count plus result-count state (`measured`, `na`, or `unknown`)
- output size
- cache state (`hit`, `miss`, or `na`) for index and derived caches
- redacted input dimensions such as query length, limits, and batch sizes
- error presence, including MCP tool errors

It does **not** log prompts, source file contents, or full MCP payload bodies.

Optionally, set `VB6_LSP_TELEMETRY_CAPTURE_INPUTS=1` to also record the raw text arguments (capped at 160 chars) on **miss/error events only** — useful for diagnosing why lookups fail. Successful calls never record raw inputs.

Generate a local usage report with:

```bash
npm run telemetry:report
```

### MCP index cache location

MCP index snapshots are read-oriented and use the platform user cache by default, so the first analysis does not create files in the VB6 workspace. To choose another cache root explicitly, set `VB6_LSP_CACHE_DIR`. To opt into the historical workspace-local location for a deliberate local-cache workflow, set `VB6_LSP_CACHE_MODE=workspace`; that writes under `.vb6-lsp-cache/`, which remains ignored by Git.

The snapshot contains indexed symbols plus the source lines used by MCP analysis, so treat the cache as sensitive local data. It is not encrypted and has no automatic time-to-live. Entries are invalidated when the workspace/source-directory key, cache version, file path, file size, or file modification time changes. To remove it manually, stop the LSP/MCP process and delete the `vb6-lsp` directory under `%LOCALAPPDATA%` (or `%APPDATA%` fallback) on Windows, `~/Library/Caches/vb6-lsp` on macOS, `~/.cache/vb6-lsp` or `$XDG_CACHE_HOME/vb6-lsp` on Linux, or the directory selected by `VB6_LSP_CACHE_DIR`. In explicit workspace mode, delete the workspace's `.vb6-lsp-cache` directory.

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

For a core request-mix baseline that does not compile the server or write a result file, run it against the checked-in fixture after a build has produced `out/`:

```bash
npm run benchmark:core -- --root tests/fixtures/advanced-workspace --source-dirs App/source --iterations 5
```

The JSON reports corpus size, cold/warm index p50/p95, LSP definition/references/completion, MCP reference analysis, and peak RSS. The checked-in isolated baseline is recorded in [docs/improvement-cycle-2026-08-04-p3-performance-baseline.md](docs/improvement-cycle-2026-08-04-p3-performance-baseline.md).

There is also an **agent-rescue benchmark** that replays the failure shapes observed in real MCP telemetry (ambiguous filenames, qualified names, argument aliases, broken scopes, out-of-order token queries) through the live server and gates on a 95% rescue rate:

```bash
npm run benchmark:rescue -- --root "C:/path/to/vb6-workspace" --source-dirs "src;forms;shared"
```

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
npm test
npm run verify:package:built
npm run package:vsix
```

Useful folders:

- `src/server/indexer/*` for parsing and indexing
- `src/server/providers/*` for LSP features
- `src/mcp/*` for MCP tools
- `tests/*` for automated validation

The repo also includes a VS Code launch configuration that starts an Extension Host against the fixture workspace in `tests/fixtures/sample-workspace`.

## Scope

The 3.4.0 release positions `vb6-lsp` as both a practical VB6 editor integration and an agent-first MCP analysis surface:

- portable workspace discovery via `.vbp`
- project-wide symbol search and navigation
- contextual local/parameter-aware resolution for the main authoring features
- member access when the receiver type is known
- member access inside `With` blocks
- basic form/control awareness for `.frm` files
- text UserControl awareness for `.ctl` files, with Active Designer `.dsr` files explicitly unsupported
- project/reference awareness from `.vbp`
- richer MCP workflows for project and reference inspection
- higher-level agent-first analysis workflows
- specialized workflows for common legacy VB6 investigation tasks
- bundled one-call analyses for symbols and modules
- directional flow tracing and state-oriented analysis
- smarter ranking and trimming for heavy agent analyses
- project-level startup/reference impact workflows
- semantic tokens and richer quick fixes in the editor
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
- richer MCP workflows for projects, references, and type members
- higher-level agent workflows for explanation, tracing, mutations, and entrypoint discovery
- specialized analysis workflows for packet handlers and UI-heavy forms
- `.frm` designer control indexing
- member access inside `With` blocks
- missing external project reference diagnostics
- LSP end-to-end requests over stdio
- MCP stdio tool exposure, indexing, and richer tool workflows
- unsaved-buffer authority across indexing, diagnostics, tokens, references, rename, and code actions
- shared `.ctl`/`.dsr` component policy, provider matrix, and cancellation behavior
- MCP cache location, invalidation, migration, and workspace-key isolation
