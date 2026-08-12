# Improvement cycle: Marketplace asset baseline (2026-08-04)

## Failure signature

The extension manifest had repository, homepage, bugs, category, and gallery banner metadata, but no `icon`. [VS Code's extension manifest](https://code.visualstudio.com/api/references/extension-manifest) and [publishing guidance](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) require a PNG icon of at least 128x128 pixels; screenshots and the demo GIF also remain absent.

## Acceptance criterion

- `package.json` points to a checked-in PNG icon at least 128x128.
- `npm run verify:package` validates the icon signature and dimensions.
- The icon is a neutral technical placeholder that can be replaced before publication without changing runtime behavior.
- Screenshots/GIF remain explicitly pending a real VS Code smoke run; no fabricated UI evidence is added.

## Verification layer

- Static: manifest and asset-path inspection.
- Isolated: PNG header/dimension validation and visual inspection of the icon.
- External: Marketplace submission and published screenshots require explicit authorization and a clean-profile run.

## Rollback boundary

Rollback is limited to `images/icon.png`, the manifest `icon` field, verifier validation, and this note. No LSP/MCP behavior changes.
