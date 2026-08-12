# Improvement cycle: supported Node LTS lanes (2026-08-04)

## Scope

Declare a supported Node runtime floor and test the existing Windows suite on two supported LTS lines. The official [Node.js release table](https://nodejs.org/en/about/previous-releases) currently lists Node 22 and 24 as LTS and Node 20 as EOL. No application dependency is added or upgraded.

## Acceptance criterion

- `package.json` and the lockfile root package declare `node >=22.0.0`.
- `.github/workflows/ci.yml` runs the existing deterministic install and test job on Node 22 and Node 24.
- README states the runtime prerequisite.

## Verification status

Static manifest/workflow inspection only. The matrix still requires GitHub Actions execution; the local server build and full suite remain user-gated by `IMPROVEMENT_LOOP.md`.

## Rollback boundary

Rollback is limited to the runtime metadata, CI matrix, README prerequisite, and this note. Dependency ranges and lockfile package resolutions are untouched.
