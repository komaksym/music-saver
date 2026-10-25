# Contributing

Thanks for your interest in contributing! Please take a moment to read this
guide so your contribution goes smoothly.

## Getting started

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/your-feature`.
3. Install the locked dependencies with `npm ci`.
4. Make your changes and commit them with a clear message.
5. Push and open a pull request against the default branch (`main`).

## Pull request checklist

- [ ] The PR description explains what and why.
- [ ] `npm run lint` passes.
- [ ] `npm test` passes.
- [ ] `npm run verify` passes; `extension/content.bundle.js` stays fresh.
- [ ] New behavior is covered by tests.
- [ ] Documentation is updated if user-facing behavior changed.
- [ ] Browser changes attach E2E proof artifacts.

## Browser E2E

`node scripts/spotify-e2e.mjs fixture` runs the controlled player matrix.
Live runs need a dedicated authenticated profile. Never use a personal
Spotify account for these tests, and never commit cookies or auth state.
See [docs/spotify-e2e.md](docs/spotify-e2e.md) for coverage, authentication,
artifacts, and the GitHub check names.

## Issue conventions

- Use the issue forms: bug reports, feature requests, questions.
- Label your issue with the matching `bug` / `enhancement` / `P0`–`P3` label.

## Commit style

Use conventional commits **with a scope**: `type(scope): description`

```
feat(labels): add tier labels
fix(ci): correct release workflow
```

Common types: `feat` `fix` `docs` `chore` `refactor` `test` `ci` `perf`.
Scope = the area you touched (module, file, subsystem).

Examples:

```
feat(labels): add tier labels
fix(ci): correct release workflow
docs(readme): explain installation
chore(ci): bump action version
```

## Code style

Match the existing style of the project. `npm run lint` enforces it.

## Questions?

Open a `question` issue. We're friendly!
