# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately instead:

- Open a [private security advisory](https://github.com/komaksym/music-saver/security/advisories/new), or
- Email the maintainers (see repository profile for contact).

You should receive a response within 7 days. Please include:

- Affected version(s) / commit
- Steps to reproduce
- Impact description

## Scope

The extension reads the Spotify web player DOM and reuses the existing browser
session. It stores settings, the activity log, and the retry queue in
`chrome.storage.local`. It does not request OAuth tokens or Premium access.
Reports about session handling, injected page scripts, or the E2E profile flow
are in scope.

## Supported versions

| Version | Supported |
|---------|-----------|
| latest  | yes |
| older   | no (best effort) |

## Disclosure

We appreciate responsible disclosure. Once a fix is released, we will
acknowledge the reporter in the release notes (unless anonymity is requested).
