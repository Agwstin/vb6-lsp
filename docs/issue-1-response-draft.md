# Issue #1 response draft — FRX/RES

> Draft only. Do not post without explicit maintainer approval. This draft is
> intentionally scoped to the current source candidate, not a published 3.4.0
> release.

Thanks for pointing me to [VB6_lsp](https://github.com/bhattumang7/VB6_lsp). I
checked its public README and the `.frm`/`.ctl` companion and `.res` support it
describes. That is a useful compatibility reference, and I do not want to
pretend that the two implementations have identical behavior without comparing
real fixtures.

I have started a bounded, read-only resource slice in `vb6-lsp`:

- `inspect_frx` can inspect a referenced `.frx`/`.ctx` value from a `.frm` or
  `.ctl`, with explicit bounds for text, picture, font, and list records;
- `inspect_res` reports standard `.res` entry metadata and extracts standard
  `RT_STRING` values, including the normal block/index string IDs; and
- malformed offsets, truncated records, workspace escapes, and oversized
  inputs fail without writing or returning full binary payloads.

The current checked-in fixture proves the parser contract, but the new MCP
protocol path still needs a fresh maintainer-run build and package smoke test.
It also does not yet claim proprietary OCX control bags, automatic designer
hydration, resource writing, or full compatibility with the neighboring tool.
I also saw that its public README advertises `.pag`/`.dob` companion coverage
and `.res` read/write operations; those are useful compatibility targets, but
I want an actual fixture and expected result before matching that surface.

Could you share which result matters first in your project: image/icon
extraction, control-property values, long strings/list items, `.res` string
tables, or designer/form-layout awareness? An anonymized `.frm`/`.ctl` plus its
companion and the expected value/offset would let me add the smallest useful
regression fixture without copying implementation code.
