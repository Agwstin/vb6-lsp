# Improvement cycle: deterministic CI installation (2026-08-04)

## Scope

Change the existing Windows CI lane from `npm install` to `npm ci`, matching the lockfile and the P1 backlog. No dependency versions, action versions, operating-system matrix, packaging job, or release credentials are changed here.

## Failure signature

The workflow installed dependencies with `npm install`, allowing the CI environment to resolve ranges instead of enforcing the committed lockfile. The cheapest correction is a one-line workflow change; the resulting job still runs the existing `npm test` gate.

## Acceptance criterion

`.github/workflows/ci.yml` uses `npm ci` before `npm test`.

## Verification status

Static YAML inspection only. GitHub Actions execution remains pending a push/PR or an authorized local CI run; no local server build was run by this agent.
