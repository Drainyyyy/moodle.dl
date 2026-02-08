# Contributing

Thanks for helping improve **moodle.download**.

## Development setup

```bash
npm install
cp .env.example .env
```

## Code style

- ESLint: Airbnb TypeScript (see `.eslintrc.cjs`)
- Prettier: 2 spaces, single quotes, trailing commas

Commands:

```bash
npm run lint
npm run format
npm run typecheck
npm run test
```

## Branch strategy

- `main`: stable releases
- `develop`: integration branch (optional)
- `feature/*`: feature work

## Commit convention

Use **Conventional Commits**:

- `feat: ...`
- `fix: ...`
- `docs: ...`
- `chore: ...`

## Pull requests

1. Open a PR against `main` (or `develop` if used)
2. Ensure CI passes (lint + tests)
3. Keep PRs focused and include screenshots when UI changes

## Testing requirements

- Unit tests are in `tests/unit` (Vitest)
- E2E tests are optional for MVP
