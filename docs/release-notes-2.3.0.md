# VB6 Language Server 2.3.0

`2.3.0` is a compatibility and project-shape release aimed at more designer-heavy VB6 codebases.

## Highlights

- `.frm` designer control awareness
- Member access inside `With ... End With`
- More compatibility fixtures and regression coverage

## Form / designer awareness

- Indexes `.frm` controls declared in designer `Begin ... End` blocks
- Exposes those controls as indexable members
- Improves document-symbol output for those member-like symbols

## Member access improvements

- Member completion and navigation now work inside `With` blocks when the receiver can be resolved

## Validation

- `17/17` automated tests passing
- expanded fixture coverage for forms, controls, and `With`-block access patterns
