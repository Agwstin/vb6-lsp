# 3.4.0 launch kit (draft)

> Local draft only. Do not publish this copy until the maintainer has run the
> full suite, built the VSIX, and completed the clean-profile smoke test. The
> Marketplace and Open VSX listings are not assumed to exist.

## Positioning

**Tagline (15 words):**

> Modern navigation and AI-assisted analysis for real Visual Basic 6 `.vbp` codebases in modern editors.

**Short description:**

> VB6 language server and MCP tools for navigating, analyzing, and refactoring real `.vbp` codebases.

## 150-word technical launch post

Visual Basic 6 systems are still running businesses. `vb6-lsp` brings that work
into a modern editor and agent workflow: one project-aware analysis core powers
both an LSP and MCP tools.

The 3.4.0 candidate focuses on trust before breadth. It understands project
components and references, keeps open unsaved editor text authoritative for
navigation and diagnostics, and gives MCP users search, symbols, references,
call-flow, and state-analysis workflows. The resource slice is deliberately
read-only: `inspect_frx` handles bounded common `.frm`/`.ctl` companion values,
while `inspect_res` reports standard `.res` metadata and `RT_STRING` values
without returning or rewriting arbitrary binary data.

This is VB6 tooling, not a claim of VBA, VB.NET, twinBASIC, compiler, designer,
or full COM compatibility. Install the verified artifact, open a workspace that
contains a `.vbp`, try Go to Definition and Find All References, then ask one
MCP question. If the first result is wrong, please report the smallest
anonymized fixture that reproduces it.

## Demo asset checklist

Create these from the verified release, not from a mock or stale `out/` tree:

1. **GIF, 30–45 seconds:** open the sample `.vbp`; jump to `UseShared`; show
   Find All References; introduce an unsaved missing `End Sub`; show the
   diagnostic; run one MCP `find_references` or `inspect_res` request.
2. **Screenshot 1 — navigation:** the definition target and references list
   visible together, with the workspace path visible but no private paths.
3. **Screenshot 2 — correctness:** an unsaved-buffer diagnostic and the
   corresponding code action, using only the checked-in fixture.
4. **Screenshot 3 — agent workflow:** the MCP request and a compact result;
   redact workspace names, usernames, and source content that is not public.

Suggested alt text:

- `VS Code opens a VB6 .vbp workspace and shows Go to Definition for a shared routine.`
- `VB6 LSP reports a missing End Sub in unsaved editor text and offers a code action.`
- `MCP returns structured VB6 references from the same project-aware analysis core.`

## First-success script

1. Install the verified VSIX using the release instructions.
2. Open the repository's sample workspace containing a `.vbp` file.
3. Open a `.bas` or `.frm` file, invoke **Go to Definition**, then **Find All
   References** on `UseShared`.
4. Optional MCP check: ask for the references to `UseShared` or inspect the
   checked-in resource fixture.

Success means a tester reaches a useful navigation result in ten minutes or
less without cloning the source tree or editing configuration by hand.

## Call to action

> Try this on a real `.vbp` and report the first incorrect navigation result.

Ask for one reproducible outcome, not a star. A small anonymized fixture,
expected result, actual result, client name, and version are more useful than a
generic “it does not work” report.

## Publication gates

- [ ] Maintainer-run `npm test` is green on a clean checkout.
- [ ] `npm run verify:package:built` passes with `frx.js` and `res.js` present.
- [ ] `npm run package:vsix` creates the candidate artifact.
- [ ] Clean VS Code profile installs the VSIX and reaches definition/references.
- [ ] GIF and screenshots show the current artifact, not source-only behavior.
- [ ] Marketplace/Open VSX links are added only after their listings are live.
- [ ] User explicitly approves any issue reply, release, or community post.

## Weekly funnel snapshot

Record these values on the same day each week:

| Metric | Baseline | Week 1 | Week 2 | Week 3 | Week 4 |
| --- | ---: | ---: | ---: | ---: | ---: |
| GitHub unique visitors |  |  |  |  |  |
| Repository clones |  |  |  |  |  |
| Release/registry installs |  |  |  |  |  |
| First-run reports |  |  |  |  |  |
| External compatibility issues |  |  |  |  |  |
| Stars | 3 |  |  |  |  |

Interpret the funnel in order: impressions → repository visit → install →
first successful navigation → feedback or contribution. If a stage is weak,
fix that stage before adding another promotion channel.
