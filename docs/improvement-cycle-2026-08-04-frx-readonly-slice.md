# FRX/CTX read-only slice (2026-08-12)

## Decision

The first implementation from issue #1 is a bounded MCP inspection tool named
`inspect_frx`. It resolves one reference from a `.frm` or `.ctl` file and
returns a structured value without changing the companion file or the source
workspace. A second bounded tool, `inspect_res`, now reads standard `.res`
record metadata and `RT_STRING` table values. Resource writing, automatic
designer hydration, and proprietary OCX bags remain separate follow-up
decisions.

This is intentionally smaller than “support all resources like VB6.” The issue
comment identifies a useful neighboring project, but it does not specify which
user-visible behavior is needed. A read-only probe gives us an observable
interoperability surface while preserving a clean boundary for the missing
real-world fixture.

## Public comparison evidence

The neighboring [VB6_lsp repository](https://github.com/bhattumang7/VB6_lsp)
has a public README that advertises `.frm`/`.ctl` companion `.frx` support,
`.pag` PropertyPages, `.dob` UserDocuments, `.res` support, and both LSP and
MCP binaries under an MIT license. It also advertises CLI/MCP `.res` reads and
writes. Those are public compatibility claims, not proof that its exact
decoder behavior, fixtures, or APIs are compatible with this TypeScript
server. The local implementation independently chooses the safer first step:
decode by an explicit or property-derived kind and report malformed/truncated
records instead of guessing from a signature byte. `.pag`/`.dob` indexing and
resource writes therefore remain separate decisions here; no source code or
binary fixture was copied.

The `.res` record framing follows Microsoft's documented
[`RESOURCEHEADER`](https://learn.microsoft.com/en-us/windows/win32/menurc/resourceheader)
and [resource file format](https://learn.microsoft.com/en-us/windows/win32/menurc/resource-file-formats)
references: size-prefixed, variable type/name fields, fixed metadata, and
DWORD-aligned data.

## Local API and limits

`inspect_frx` accepts:

```json
{
  "file": "Form1.frm",
  "value": "\"Form1.frx\":0000",
  "property": "Caption"
}
```

Supported first-slice kinds are `string_short`, `string_medium`, `string_long`,
`picture`, `font`, `list`, and explicit `opaque`. Property names select the
safe default: caption/text-like values select short, medium, or long strings,
picture/icon values
select `StdPicture`, font values select `StdFont`, and list values select list
records. A property-derived short-string reference is promoted to the medium
framing only when its first byte is the unambiguous `0xFF` marker. Unknown
properties stay opaque unless the caller supplies an explicit kind.

`inspect_res` accepts a workspace-relative `.res` path and reports each
standard resource record's type, name, language, framing, size, and bounded hex
preview. Standard `RT_STRING` entries are decoded into numeric string IDs and
values using the Windows block/index convention (block 1 contains IDs 0 through
15). Resource-specific payloads are not guessed or returned in full. `.res`
files are capped at 64 MiB, previews at 256 bytes, and reported entries at
1,000. String-table output is capped at 1,000 values and 2,048 characters per
value; malformed record alignment and variable-length names fail explicitly.

Safety boundaries are fixed in `src/mcp/frx.ts`:

- companion file maximum: 64 MiB;
- decoded value maximum: 4 MiB;
- picture/opaque preview maximum: 256 bytes as hex;
- list output maximum: 200 items;
- companion path must remain inside the configured workspace; and
- no resource-writing API exists in this slice.

Malformed prefixes, offsets, picture framing, list lengths, and truncated
payloads return explicit recoverable errors. The medium text decoder exposes a
`lengthAdjusted` flag when it handles the historical one-byte end-of-file
length mismatch; larger truncations still fail. UTF-16LE text is detected with a
conservative high-byte heuristic; other text uses a bounded Windows-1252
decoder. Local machine ANSI code pages outside Windows-1252 and analogous
one-byte records remain unclaimed.

## Fixture and proof

`tests/fixtures/frx-workspace/Form1.frm` sits beside a small reviewable
`Form1.frx` fixture. Its first byte (`0x40`) is the short-string length (64),
so the fixture remains text-reviewable while still exercising the real
length-prefixed record shape. `tests/frx.test.js` verifies reference parsing,
property selection, short/medium/long text decoding, standard picture metadata, malformed/truncated
failure, and workspace-path bounds. The companion `tests/res.test.js` covers
standard `.res` headers, string tables, malformed records, and workspace-path
bounds. Each test file also contains an MCP protocol check that runs after the
generated `out/mcp` tree contains the new source module; it is skipped before a
fresh build so a stale output tree cannot produce a false pass.

An additional in-memory adversarial sweep sent 1,000 random malformed buffers
through each parser; all 2,000 calls returned a structured result without a
throw or generated artifact.

## Not yet claimed

- binary resource writes or round-trip preservation;
- proprietary ActiveX/OCX control bags;
- automatic scanning of every resource reference in a form; or
- GUI designer rendering of decoded resources.

The next evidence gate is a maintainer-run build and full test/package pass,
followed by one real anonymized `.frm` + `.frx` or `.res` scenario. Only after
that scenario is confirmed should the issue response or broader compatibility
claim be considered; no external reply is part of this change.
