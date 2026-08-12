# Security policy

## Scope

Please report vulnerabilities in the extension, LSP server, MCP server, telemetry, cache handling, or packaging that could expose source, credentials, or execute unintended actions.

## Do not disclose sensitive material publicly

Do not put proprietary VB6 source, customer names, credentials, access tokens, workspace paths, telemetry payloads, or exploit details in a public issue. Replace code with a minimal synthetic fixture whenever possible.

If GitHub's private vulnerability reporting is enabled for this repository, use that channel. Otherwise, contact the maintainer through a private GitHub channel before opening a public issue. The repository does not promise a response time until a private reporting channel and SLA are published.

Include only what is necessary to reproduce the problem: affected version or commit, operating system, Node.js version, configuration shape with secrets removed, exact command, and observed versus expected behavior. Redact logs before sharing them.

## Safe handling while investigating

- Prefer read-only fixtures and a temporary workspace.
- Keep telemetry and cache directories outside proprietary repositories unless workspace-local mode is explicitly required.
- Do not test identity, account, or external-service actions with production credentials.
- Stop and ask for authorization before publishing a fix, issue response, or advisory.
