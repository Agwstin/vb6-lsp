# Improvement cycle: contributor and support surface (2026-08-04)

## Failure signature

The repository has installation and compatibility guidance but no local contribution guide, security disclosure guidance, issue forms, or pull-request checklist. That makes a first compatibility report more likely to include proprietary VB6 source or omit the exact project/provider context needed to reproduce it.

## Acceptance criterion

The repository provides:

- a contributor guide with the supported setup, evidence ladder, and no-publication boundary;
- security guidance that keeps credentials and proprietary source out of public issues;
- issue forms for bugs and real-project compatibility reports;
- a pull-request checklist that distinguishes static, isolated, protocol, and real-project evidence.

The forms must be valid YAML and must not require an account, secret, or proprietary source attachment.

## Verification layer

- Static: inspect the new Markdown and YAML files.
- Isolated: parse the issue forms with the repository's available YAML parser.
- External: publication, issue triage, and maintainer response time remain outside this cycle.

## Rollback boundary

Rollback is limited to the new contributor/support documents and GitHub templates. No product code, dependency, runtime behavior, or external service state changes.
