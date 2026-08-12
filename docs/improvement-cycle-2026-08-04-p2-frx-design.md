# Improvement cycle: FRX research and decision boundary (2026-08-04)

> Historical design boundary. The decision was made in the 2026-08-12 follow-up:
> see [the implemented read-only FRX/RES slice](improvement-cycle-2026-08-04-frx-readonly-slice.md).

## Evidence reviewed

- [Issue #1](https://github.com/Agwstin/vb6-lsp/issues/1) remains open and its body still asks only for “FRX binary resource file parsing”; no follow-up comment specifies whether the desired result is image/icon extraction, long-string/list-item recovery, control-property display, or form-layout awareness.
- Microsoft’s [KB152582](https://ftp.zx.net.nz/pub/archive/ftp.microsoft.com/MISC/KB/en-us/152/582.HTM) describes `.frx` as the binary companion to a same-named `.frm`, storing binary properties such as PictureBox/Image data and requiring the pair to remain together.
- The [VB6Parse FRX format notes](https://scriptandcompile.github.io/vb6parse/technical/frx-format.html) describe offset-referenced variable-length records, little-endian fields, Windows-1252 text, no dependable file-level signature, and malformed/off-by-one cases that require bounded parsing.
- The related [VB6_lsp project](https://github.com/bhattumang7/VB6_lsp) advertises `.frm`/`.ctl` companion `.frx` support, but its implementation and license/API boundaries must be inspected before any reuse or collaboration claim.

## Causal constraint

FRX is not a standalone text source. A parser cannot infer the intended property from bytes alone; it needs the paired `.frm`/`.ctl` reference and must treat the referenced offset as untrusted input. A broad “parse FRX” feature would therefore risk returning misleading values or allocating unbounded data without a concrete user outcome and adversarial fixtures.

## Decision required before implementation

Choose the first observable result:

1. resolve a form/control property reference to a bounded byte/string summary;
2. extract embedded images/icons to a read-only temporary/result representation;
3. recover long strings/list items for navigation or diagnostics; or
4. expose only a safe offset/length inspection report.

At the time of this 2026-08-04 note, no FRX parser or GitHub issue response was
claimed. The later source slice chooses result (1) plus bounded metadata and
keeps the issue response gated behind user approval.

## Smallest safe follow-up once chosen

Add a paired `.frm`/`.frx` fixture with one target value and malformed/truncated variants; implement a read-only bounded inspector behind an explicit MCP/LSP surface; assert offset bounds, maximum allocation, Windows-1252 decoding, and graceful unsupported-type reporting. Keep resource rewriting out of scope.

## Verification status

At the time of the original note this was a research/design artifact only. The
later source slice still performs no resource writes, adds no dependency, and
sends no external message.
