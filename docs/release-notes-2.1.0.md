# VB6 Language Server 2.1.0

`2.1.0` is a focused polish release for the editor experience and project reliability.

## Highlights

- Semantic tokens for richer declaration highlighting
- Basic quick fixes for common diagnostics
- GitHub Actions CI for build and test validation

## Editor improvements

- Added semantic tokens for indexed VB6 declarations
- Added code actions for:
  - missing `Option Explicit`
  - missing `End Sub` / `End Function` / related block terminators

## Reliability

- Added CI on GitHub Actions
- Expanded the automated suite to `14/14` passing tests

## Notes

This release builds on `2.0.0` without changing the overall architecture. It focuses on making the editor integration feel more complete and making the repo easier to maintain safely.
