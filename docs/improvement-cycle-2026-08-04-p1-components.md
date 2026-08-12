# Improvement cycle: P1 supported VB6 components (2026-08-04)

## Scope

Unify the component policy for VB6 modules, classes, forms, and UserControls. Add `.ctl` support where the real fixture proves its text/code shape is safely handled. Keep Active Designer `.dsr` discovery explicit but unsupported until its designer-specific shape has a dedicated fixture.

Explicitly out of scope: `.dsr` parsing, binary `.ctx`/`.dsx`/`.frx` resources, unsaved-buffer behavior, MCP cache relocation, multi-root routing, release publication, and external messages.

## Proof before code

- Failure signature: before this cycle, `.vbp` parsing already recognized `UserControl=` and `Designer=`, but the indexer, watcher, client registration, and MCP collector only accepted `.bas`, `.cls`, and `.frm`.
- Cheapest discriminating evidence: a real `.ctl` fixture with a `VB_Name`, a public routine, and a designer control; a `.vbp` entry for that fixture; and a `.dsr` entry proving unsupported status is visible rather than silently omitted.
- User-visible acceptance: a `.ctl` component appears in project metadata, is indexed by LSP/MCP, is watched/registered as VB6 source, and has regression coverage. A `.dsr` component is listed with an explicit unsupported limitation and is not falsely indexed.
- Required test layer: focused config/index/MCP tests plus static policy consistency; compiled suite/protocol evidence remains a user-run gate.
- Rollback boundary: shared component-policy module, config metadata, extension lists, indexer/watcher/MCP collector, fixtures/tests, and this cycle note only.

## Evidence from domain research

VB6 UserControls are stored as text `.ctl` files; Active Designer files are `.dsr` and may contain designer-specific metadata that cannot be treated as ordinary class/form source without a fixture. The implementation therefore supports `.ctl` first and reports `.dsr` as unsupported.

The watcher/client glob is derived from the shared indexed-extension policy instead of duplicating an extension list.
