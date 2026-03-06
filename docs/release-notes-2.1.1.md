# VB6 Language Server 2.1.1

`2.1.1` is a patch release focused on CI reliability.

## Fixes

- Fixed test execution on Windows runners
- Replaced the shell glob-based test command with a portable Node-based test launcher

## Why this release exists

The `2.1.0` GitHub Actions workflow failed because the Windows shell did not expand the `tests/**/*.test.js` pattern the same way as the local environment. This release makes test discovery deterministic across environments.
