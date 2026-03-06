# VB6 Language Server 2.4.0

`2.4.0` is a diagnostics and editor-polish release.

## Highlights

- Missing external project reference diagnostics
- Semantic tokens beyond declarations
- Additional quick fixes for duplicate Public symbols

## Diagnostics

- Warns when a source file belongs to a `.vbp` project that references a missing external library

## Editor improvements

- Semantic tokens now cover symbol usages more broadly, not only declarations
- Added a quick fix to change explicit `Public` visibility to `Private` for duplicate Public symbol cases

## Validation

- `19/19` automated tests passing
- expanded fixture coverage for diagnostics, forms, member access, project metadata, and compatibility scenarios
