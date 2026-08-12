# vb6-lsp Improvement and Visibility Loop

> Execution brief for Luna Max. Planning baseline: 2026-08-04.

## Mission

Make `Agwstin/vb6-lsp` the easiest trustworthy way to navigate and analyze real Visual Basic 6 `.vbp` codebases from modern editors and AI coding agents.

Primary positioning:

> **Modern code navigation and AI-assisted analysis for real Visual Basic 6 `.vbp` codebases.**

The objective is not to add the largest possible number of MCP tools. The objective is to make the existing LSP + MCP core correct, installable, demonstrable, and useful to people maintaining real VB6 systems.

## Non-negotiable execution rules

1. Preserve the current working tree. It contains a large, unreleased 3.4.0 body of work: 35 dirty entries, including tracked and untracked source, tests, fixtures, telemetry, and benchmark files.
2. Never reset, revert, clean, discard, or overwrite pre-existing changes. Inspect the diff before each cycle and attribute every new edit.
3. Work on one narrowly scoped backlog item per cycle. Do not combine correctness, packaging, documentation, and promotion into an unreviewable mega-change.
4. Define an observable success criterion before editing.
5. Add or identify a failing regression test before a causal code fix whenever practical.
6. Do not claim that a change is verified merely because code was edited. Report static inspection, isolated tests, protocol/E2E tests, and real-project validation separately.
7. Obey the repository `AGENTS.md`. In particular, Luna must not execute server development build/compilation commands. When a gate requires compilation or `npm test`, stop and ask the user to run the exact command and return the exact output. Do not route around this restriction.
8. Do not add or pin a dependency without checking the current recommended release from its official registry/docs and using that as the version floor.
9. Do not commit, tag, publish, push, open PRs, reply to issues, or post to communities without explicit user authorization.
10. Keep generated binaries, VSIX files, caches, logs, and temporary outputs out of the final working tree unless the user explicitly wants a release asset preserved.

## Baseline: what exists now

### Strengths worth protecting

- One TypeScript analysis core backs both an editor-facing LSP and an agent-facing MCP server.
- `.vbp`-aware multi-project discovery is a real differentiator from VBA/Excel-centered tools.
- The LSP advertises definition, references, hover, symbols, completion, signature help, rename, folding, code actions, diagnostics, and semantic tokens.
- The MCP surface already contains search, symbol, call-flow, state, project, reference, and bundled analysis workflows.
- The planning baseline had 26 test files and 51 statically counted test cases, with especially strong MCP workflow/rescue coverage. The current source tree has 34 test files; the latest no-build direct sweep reports 71 cases (69 pass, 0 fail, 2 intentional protocol skips), pending a fresh compiled run.
- The unreleased telemetry work is based on 7,072 real MCP calls and includes a reproducible rescue benchmark.
- The public project has 3 stars and 1 fork. For a very young, highly specialized VB6 tool, that is a meaningful starting signal, not a failure.

### Release-state mismatch to resolve first

The public repository currently ends at `v3.3.2`, while the working tree describes an unreleased `3.4.0` in several places.

Known inconsistencies:

| Surface | Current state |
| --- | --- |
| `package.json` | `3.4.0` |
| MCP server | `3.4.0` |
| LSP server | still `3.3.2` |
| `package-lock.json` | still `3.3.2` |
| README version badge | still `3.3.2` |
| changelog | historically claims `3.4.0` and `51/51`; later maintainer evidence recorded 63/63 before the resource slice |
| release notes | no `docs/release-notes-3.4.0.md` |
| public tag/release | no `v3.4.0` |
| public release assets | no attached installable VSIX assets returned by the GitHub Releases API |

Other immediate trust problems:

- README Quick Start still uses `https://github.com/your-user/vb6-lsp.git`.
- The README leads with contributor setup instead of end-user installation.
- The README badge previously said 26 tests while the planning baseline contained 51; the current source has 34 test files and the numeric badge has been removed.
- `git diff --check` reports trailing whitespace in `tests/fixtures/advanced-workspace/App/source/frmMain.frm`.
- Line-ending behavior is not explicit enough for mixed TypeScript/Markdown and legacy VB6 fixture files.

### Highest-impact correctness defect

The server advertises incremental text synchronization, but changed open documents are not consistently the source of truth.

Current flow:

1. The client sends `didChange` for an unsaved editor buffer.
2. The server calls `indexer.rebuildFile(filePath)`.
3. The indexer rereads the saved file from disk.
4. Diagnostics, semantic tokens, references, rename, and code actions also contain independent disk reads.

Likely user-visible result: while typing, navigation and diagnostics can be stale, and refactor edits can be computed against the saved file rather than the open buffer.

Target design: one document-snapshot abstraction. Open `TextDocument` content wins; disk is a fallback only when the document is closed.

### Component-support mismatch

The `.vbp` parser recognizes components such as `UserControl` and `Designer`, but VS Code registration, indexing, file watching, and MCP collection currently converge on only `.bas`, `.cls`, and `.frm`.

This means the project model can discover a component that the analysis engine then ignores. Introduce one shared supported-component policy, proven with actual `.vbp` fixtures, and use it everywhere.

### Additional design risks

- Multi-root workspaces currently use the first workspace folder. Either document single-root behavior honestly or implement per-root routing.
- MCP caching defaults to `.vb6-lsp-cache` inside the analyzed repository. A read-oriented analysis tool should not silently mutate a consumer's source tree.
- Synchronous filesystem work occurs on the LSP event loop. Measure cold index, warm index, and request p50/p95 before attempting performance fixes.
- Several advertised provider behaviors lack focused tests, particularly hover, signature help, rename/prepare-rename safety, and workspace symbols.
- The unresolved-routine stub code action lacks a clearly named focused test.
- CI uses only Windows + Node 20, `npm install`, and `npm test`; packaging/installability is not gated.

## Prioritized product backlog

### P0 — Stabilize and publish the existing 3.4.0 work

**Outcome:** one reviewable, internally consistent candidate release without losing any current work.

Tasks:

- Inventory every dirty and untracked path; classify it as product code, regression coverage, fixture, benchmark, documentation, generated output, or unrelated user work.
- Reconcile the intended version across package metadata, lockfile, LSP, MCP, badges, changelog, and release notes.
- Add `docs/release-notes-3.4.0.md` based only on behavior demonstrated by the diff and verification evidence.
- Correct the clone URL and remove stale hand-maintained counts where a dynamic badge or non-numeric statement is safer.
- Establish deliberate line-ending rules that preserve legacy fixture semantics and avoid repository-wide churn.
- Fix only known whitespace defects; do not mechanically reformat VB6 fixtures.
- Have the user run the full approved verification command in a clean environment and return its exact output.
- Perform a clean-machine installation smoke test for the produced VSIX before any public release.

Acceptance gates:

- No pre-existing change is lost.
- All version surfaces agree.
- Release notes distinguish telemetry claims, static verification, automated tests, and real-project validation.
- `git diff --check` is clean.
- User-provided full-suite output is green.
- A fresh VS Code profile can install the VSIX, open the sample `.vbp`, and complete definition + references without manual repository setup.

### P0 — Fix the end-user installation funnel

**Outcome:** a maintainer can understand, install, and try the project in under ten minutes.

Tasks:

- Put `Install` before contributor/development instructions.
- Offer, in order: VS Marketplace, Open VSX, GitHub release VSIX, then source setup. Show only channels that are actually live.
- Document prerequisites, install, upgrade, uninstall, and first-run verification.
- Add a public sample workspace and a three-step first-success path.
- Add a 30–45 second GIF: open a `.vbp` workspace, go to definition, find references, show one diagnostic, then ask one MCP question.
- Add a compact compatibility/limitations matrix covering VB6, VBA, twinBASIC, supported file types, LSP clients, operating systems, and explicitly unsupported compiler/designer/full-COM behavior.
- Add marketplace metadata: `repository`, `homepage`, `bugs`, `icon`, `galleryBanner`, appropriate categories, screenshots, and links.

Acceptance gates:

- A tester unfamiliar with the source tree can find the correct artifact without reading Development.
- Every advertised install link resolves.
- The quick-start commands use `Agwstin/vb6-lsp` and work in a clean test environment.
- The demo shows actual output from the current release, not a mock.

### P1 — Make unsaved buffers authoritative

**Outcome:** all editor features operate on what the user currently sees.

Suggested implementation shape:

- Add a content-aware index operation such as `upsertFile(filePath, text, version)` or a shared document snapshot store.
- Route provider source access through one abstraction: open document content first, disk second.
- Remove ad hoc provider-level disk reads where the shared abstraction should own the decision.
- Handle close/save transitions without retaining stale versions.

Required regression proofs:

- Open a file, send `didChange` without saving, declare a new symbol, and find it through workspace/navigation behavior.
- Produce a missing-terminator diagnostic from unsaved text.
- Produce semantic tokens from unsaved text.
- Rename after adding/removing lines in an unsaved buffer and verify exact ranges.
- Close or save the document and prove the index converges to the expected source.

Acceptance gates:

- No provider covered by the document snapshot abstraction rereads stale disk content for an open document.
- Tests fail against the old implementation and pass after the change.
- Existing saved-file behavior remains unchanged.
- Verification status is reported as protocol/E2E, not merely unit-level.

### P1 — Unify supported VB6 component types

**Outcome:** anything recognized from `.vbp` metadata is either analyzed consistently or explicitly reported as unsupported.

Tasks:

- Build real fixtures for `UserControl`, `Designer`, and any other proposed component before changing extension lists.
- Define one shared mapping between `.vbp` entry kind, file extension, language registration, watcher, indexer, MCP collector, and parser behavior.
- Add `.ctl` support first if the fixture proves the parser can safely treat its code section like the supported form/class model.
- Add designer extensions only after validating their actual file shapes.
- Update docs and the compatibility matrix from the same policy.

Acceptance gates:

- A component cannot be listed by project discovery and silently absent from editor/MCP queries.
- All newly supported types have index, watcher, LSP, MCP, and regression coverage.
- Unsupported types produce a clear limitation rather than partial silent behavior.

### P1 — Close the advertised-provider test matrix

**Outcome:** every prominent README feature has an explicit test owner and failure signal.

Add focused coverage for:

- hover;
- signature help;
- rename and prepare-rename safety;
- workspace symbol ranking and ambiguity;
- unresolved-routine stub code action;
- cancellation/error behavior where a long request can occur;
- open-document versus saved-document behavior.

CI improvements, after checking current dependency/action versions from official sources:

- use deterministic dependency installation (`npm ci`);
- declare supported Node versions and test at least the active LTS floor;
- retain the Windows lane required by the project;
- add a cheap non-Windows protocol/core lane if path behavior is intended to be portable;
- inspect packaged VSIX contents and run a clean install smoke;
- automate release assets only after credentials and user authorization are in place.

### P2 — Investigate FRX support through the real user request

**Outcome:** respond usefully to [issue #1](https://github.com/Agwstin/vb6-lsp/issues/1) without rushing into a fragile binary parser.

**New public evidence (2026-08-12):** [@bhattumang7](https://github.com/bhattumang7) stated in [the issue discussion](https://github.com/Agwstin/vb6-lsp/issues/1#issuecomment-5265309234) that [VB6_lsp](https://github.com/bhattumang7/VB6_lsp) already supports `.frx`, `.res`, and related resources in the way they were handled by the original VB6 tooling. Treat this as a strong lead and an invitation to compare implementations, not as proof that the two projects are API-, behavior-, or license-compatible.

Research/design cycle:

1. Reproduce the user's FRX need with a minimal lawful fixture and state the exact desired result: control properties, images/icons, string values, offsets, or form-layout awareness.
2. Inspect the neighboring implementation's `.frx`/`.res` behavior, fixtures, public APIs, license, and release/install boundaries. The public README currently claims `.pag`/`.dob` companion support and `.res` read/write operations; record those as claims until a fixture or API observation verifies them. Record what is observed versus what is only claimed in the discussion.
3. Decide whether the smallest safe path is (a) interoperability, (b) a documented dependency/integration, (c) shared fixtures and compatible behavior, or (d) an independent read-only implementation. Do not copy code or design around an unverified license/API assumption.
4. Ask whether collaboration, a documented interchange format, or shared fixtures are preferable to independently duplicating a binary parser.
5. Write a design note covering bounds checks, malformed offsets, binary size limits, unsupported property types, and whether parsing remains read-only.
6. Implement the smallest valuable read-only slice behind fixtures and fuzz/adversarial tests.

**First resource slice completed in source (2026-08-12):** `src/mcp/frx.ts` and
the `inspect_frx` MCP tool provide bounded, read-only inspection for common
FRX/CTX short/medium/long text, picture, font, and list records. `src/mcp/res.ts` and the
`inspect_res` MCP tool add bounded standard `.res` entry metadata and
`RT_STRING` extraction without resource writes. The reviewable fixture is
`tests/fixtures/frx-workspace/Form1.frm` plus `Form1.frx`; the exact scope and
limits are recorded in
[`docs/improvement-cycle-2026-08-04-frx-readonly-slice.md`](docs/improvement-cycle-2026-08-04-frx-readonly-slice.md).
This does not close proprietary OCX bags, designer rendering, binary resource
writes, or the real project scenario gate.

Do not start with arbitrary resource rewriting. Binary writes materially increase corruption and security risk.

Acceptance gates:

- The first implementation satisfies a concrete issue scenario.
- A side-by-side fixture records the expected behavior for at least one `.frm` + companion `.frx` or `.res` case and makes any compatibility gap explicit.
- Malformed/truncated resources fail safely and cannot cause unbounded allocation.
- The README states exactly which FRX values are understood.
- The issue response is posted only after explicit user approval.

### P2 — Build a real-world parser/resolution corpus

**Outcome:** improvements follow evidence instead of speculative VB6 grammar expansion.

Loop:

- Capture one anonymized failing construct from a real project.
- Reduce it to the smallest fixture that retains the failure.
- Record expected symbol/diagnostic/navigation behavior.
- Apply the smallest parser or resolver fix.
- Add the regression and compare telemetry/error rates where relevant.

Candidate areas must not be implemented without a failing fixture: conditional compilation, colon-separated statements, property accessor ambiguity, suffix identifiers, complex form declarations, and external COM metadata.

### P2 — Stop writing cache data into analyzed repositories

**Outcome:** read-oriented MCP analysis leaves consumer repositories untouched by default.

Tasks:

- Move default cache storage to a user/OS cache directory keyed by a stable workspace identity.
- Keep workspace-local caching explicit and opt-in.
- Document privacy, retention, invalidation, and manual deletion.
- Test cache hits, stale invalidation, path collisions, and migration behavior.

Acceptance gates:

- First run does not create `.vb6-lsp-cache` in the target workspace unless explicitly configured.
- Cache behavior remains measurable and deterministic.

### P3 — Decide multi-root support and optimize only from measurements

**Outcome:** no ambiguous claims and no performance work without numbers.

- First document the current single-root behavior.
- Gather actual demand before implementing per-root indices.
- If implemented, route documents and project metadata to the correct root and test duplicate module names across roots.
- Benchmark cold index, warm index, definition, references, completion, and representative MCP analysis with corpus size, p50, p95, and peak memory.
- Accept residual synchronous work when its measured impact is negligible; record it as intentionally not worth changing.

## Luna Max execution loop

Use this loop for every backlog item.

### 1. Orient

- Read `AGENTS.md`, `README.md`, `ROADMAP.md`, `CHANGELOG.md`, package metadata, and the exact implementation/tests relevant to the selected item.
- Run `git status --short` and `git diff --stat`.
- Record which current changes predate the cycle.
- Select exactly one backlog item and state what is explicitly out of scope.

### 2. Define proof before code

Create a short cycle note containing:

- exact failure signature or user outcome;
- cheapest discriminating evidence;
- acceptance criterion visible to a user or protocol client;
- required test layer: static, isolated, LSP/MCP protocol, clean install, or real VB6 project;
- rollback boundary;
- expected files to change.

For performance work, include the baseline number and target. Without a number, do not call it a performance fix.

### 3. Reproduce and eliminate alternatives

- Add or identify a minimal fixture.
- Prove the current failure.
- Record discarded hypotheses with the evidence that ruled them out.
- After three failed attempts at the same approach, stop and choose a fundamentally different strategy or research the domain.

### 4. Make one focused change

- Follow existing architecture and naming.
- Reuse one shared abstraction instead of adding provider-specific patches.
- Avoid unrelated formatting, dependency churn, or opportunistic refactors.
- Keep public strings and configuration documented.

### 5. Verify on the evidence ladder

Report each rung separately:

1. **Static:** diff inspection, JSON validity, `git diff --check`, source/fixture consistency.
2. **Isolated test:** focused regression for the failure.
3. **Suite/protocol:** user-run approved test command or CI output, plus exact results.
4. **Real use:** clean VSIX/MCP setup against the sample workspace and then one real external `.vbp` project.

Because repository instructions prohibit Luna from running server development compilation commands, Luna must pause at the relevant gate and ask the user to run it. Historical `51/51` and pre-resource `63/63` statements are not current proof of the resource build; the latest no-build direct sweep is supplemental only.

### 6. Review and clean

- Inspect the final diff and working-tree status.
- Remove only artifacts created by the current cycle.
- Confirm no pre-existing file was reverted.
- Update docs/changelog only for behavior actually proved.
- State residual risks, confidence, and the highest unverified rung.

### 7. Stop for authorization

Present the change and evidence. Ask before commit, tag, push, release, marketplace publication, issue replies, submissions to lists, or community posts.

## First Luna Max prompt

Copy this as the first execution request:

```text
Work through Phase P0 "Stabilize and publish the existing 3.4.0 work" in IMPROVEMENT_LOOP.md, but stop before any commit, tag, push, release, marketplace action, or external message.

Start by reading AGENTS.md and inventorying the entire dirty working tree. Preserve every pre-existing change and do not reset, clean, revert, or overwrite user work. Reconcile only repository-internal 3.4.0 release consistency, README trust defects, release notes, line-ending policy, and known whitespace defects. Do not expand product features in this cycle.

Before editing, report the exact intended files, acceptance criteria, and which verification commands repository policy prevents you from running. Make one focused change at a time and inspect its result. At the end, provide: files changed, exact static checks, tests not run, commands the user must run, residual risks, and whether the candidate is ready for a clean-install VSIX smoke test.
```

## Visibility plan: turn three stars into real users

### Principle

Do not promote a source checkout that lacks a clear end-user install path. Conversion work comes before reach.

The strongest message is not “another MCP server.” It is: safely understand and navigate a legacy VB6 system, in an editor or with an agent, using the same `.vbp`-aware analysis core.

### Public repository conversion checklist

- Suggested GitHub About description: `VB6 language server and MCP tools for navigating, analyzing, and refactoring real .vbp codebases.`
- Set the homepage to the primary install page once it exists.
- Retain current topics and consider: `vscode-extension`, `visual-basic`, `legacy-code`, `static-analysis`, `code-navigation`, `developer-tools`, `typescript`, and `ai-coding`.
- Add dynamic CI/release badges rather than manually maintained test counts.
- Add `CONTRIBUTING.md`, `SECURITY.md`, support expectations, issue forms, and a pull-request template.
- Create `good first issue` tasks around isolated fixtures, documentation corrections, and compatibility reports.
- Enable Discussions only if the maintainer can check it at least weekly.
- Attach an installable VSIX to each release and publish to VS Marketplace/Open VSX only after clean-profile verification.
- Avoid releasing many versions in a single day. Prefer fewer releases with a clear user story, evidence, and upgrade notes.

### Launch asset pack

Create once and reuse responsibly:

- one 30–45 second GIF;
- three screenshots: navigation, diagnostic/refactor, MCP analysis;
- a 15-word tagline;
- a 150-word technical launch post;
- a feature/limitations matrix;
- a reproducible sample `.vbp` workspace;
- one concrete call to action: **“Try this on a real `.vbp` and report the first incorrect navigation result.”**

The local draft copy, including the 150-word post, first-success script,
asset checklist, and weekly funnel table, is
[`docs/launch-kit-3.4.0.md`](docs/launch-kit-3.4.0.md). It is not a release or
publication authorization.

Do not ask only for stars. Ask for a real compatibility result. Useful issues and outside fixtures make the tool better; stars tend to follow.

### Community sequence

Post sequentially, review feedback for a week, and adjust before the next channel. Never paste the identical message everywhere on the same day.

1. [VBForums](https://www.vbforums.com/) — start with the “Visual Basic 6 and Earlier” audience; share a technical demo and ask for compatibility feedback while respecting promotion rules.
2. [r/visualbasic](https://www.reddit.com/r/visualbasic/) — use explicit “VB6, not VB.NET/VBA” framing and a short GIF.
3. [twinBASIC community channels](https://docs.twinbasic.com/FAQ) — ask for adjacent compatibility feedback, not a sales pitch.
4. [awesome-vba](https://github.com/sancarn/awesome-vba) — submit only after install and contribution docs are stable; position it under VB6 tooling, not general VBA promises.
5. [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) — submit after a documented, reproducible MCP install is available.
6. Related tool maintainers — propose neutral cross-linking or shared fixtures only where it helps users. Do not use unrelated issues for promotion.
7. Show HN/dev.to — later, after one-command installation, a strong demo, and at least one external user story exist.

There is an unusually good collaboration opening already: [issue #1](https://github.com/Agwstin/vb6-lsp/issues/1) is a real modernization user asking about FRX, and [@bhattumang7 has now confirmed](https://github.com/Agwstin/vb6-lsp/issues/1#issuecomment-5265309234) that the neighboring project handles `.frx` and `.res`. A thoughtful technical response, implementation comparison, and shared-fixture discussion are more valuable than a generic launch post.

A local, non-published response draft is staged at
[`docs/issue-1-response-draft.md`](docs/issue-1-response-draft.md). It remains
approval-gated until the fresh build/package and real-project evidence exist.

### Four-week visibility loop

#### Week 1 — Convert

- Snapshot GitHub traffic, clones, stars, release downloads, registry installs, open issues, and first-run reports.
- Fix README installation and metadata.
- Produce the GIF and public sample.
- Publish nothing until the clean-install path passes.

#### Week 2 — Release and listen

- With explicit approval, publish one coherent verified release and install artifact.
- Reply to issue #1 with scope questions or a concrete FRX design direction.
- Post to one VB6-specific community.
- Ask each tester whether definition/references worked within ten minutes.

#### Week 3 — Fix the largest onboarding/correctness failure

- Classify feedback into discovery, installation, indexing, correctness, and missing-feature failures.
- Fix the highest-frequency/highest-impact category through the Luna loop.
- Publish a short evidence-based update, not a broad marketing blast.

#### Week 4 — Expand one channel

- Post to the next community with the improved demo and one real user result.
- Open 2–4 tightly scoped `good first issue` items.
- Submit to one relevant curated list only if its contribution criteria are met.
- Review funnel metrics and choose the next product cycle from observed failures.

### Thirty-day goals

Primary goals:

- 5 external users complete installation on real VB6 projects.
- 3 actionable external feedback reports.
- At least 1 outside contribution, fixture, or documentation correction.
- At least 50% of testers reach successful definition/references within ten minutes.

Secondary goals:

- 100 verified Marketplace installs or release downloads, adjusted after the week-one baseline.
- Grow from 3 to 10 stars; 15 is a stretch goal.

Stars are a lagging signal. Completed installs, first success, actionable reports, and returning contributors are stronger evidence that the repository is becoming known for the right reason.

### Weekly funnel diagnosis

| Funnel step | Metric | If weak, improve |
| --- | --- | --- |
| Community impression → repository visit | referral traffic / unique visitors | message, audience, demo thumbnail |
| Repository visit → artifact install | installs or release downloads / visitors | README CTA, trust, artifact availability |
| Install → first successful navigation | tester checklist | onboarding, workspace discovery, correctness |
| First success → feedback/star | issues, discussions, stars | call to action, contributor surface, follow-up |

GitHub traffic is a rolling window, so record the same metrics weekly instead of relying on memory.

## Decisions Luna must bring back to the user

Do not silently decide these:

1. Is 3.4.0 the intended next public version, or should the current work be split into smaller releases?
2. Should the primary install channel be VS Marketplace, GitHub VSIX, Open VSX, or a deliberate staged sequence?
3. Is multi-root support a real user requirement, or should the current single-root behavior simply be documented?
4. What exact FRX user outcome matters first?
5. Is the maintainer willing to check GitHub Discussions weekly?
6. Which real VB6 project can be used for non-public compatibility validation without exposing proprietary source?

## Definition of success

This plan succeeds when:

- the public release matches the tested source;
- a new user can install and reach a useful VB6 navigation result in under ten minutes;
- unsaved editor content is handled correctly;
- supported project component types behave consistently across LSP and MCP;
- new parser/MCP work is driven by fixtures, telemetry, or external reports;
- public promotion produces real VB6 compatibility evidence, not only impressions;
- the project grows without sacrificing the narrow, credible promise that makes it distinctive.
