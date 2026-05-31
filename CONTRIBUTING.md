# Contributing to Company Brain

Thanks for your interest! Company Brain is meant to be forked, adapted, and improved.
Contributions of all sizes are welcome.

## Setup

```bash
git clone <your-fork-url>
cd company-brain
npm install
npm run demo      # http://localhost:4000 — runs on seed data, no credentials
npm test          # must stay green
```

No API keys or database are needed to develop — mock mode covers everything.

## Ground rules

- **Keep the trust contract intact.** Answers must stay grounded and cited; the brain
  must refuse when it has no context. Don't weaken `src/agents/prompts.ts` or remove
  the refusal test.
- **Respect the seams.** Shared metadata keys live in `src/constants.ts` only.
  External services (Langbase, Postgres) stay behind their interfaces.
- **Keep pure things pure.** Templating (`documents.ts`) and prompts (`prompts.ts`)
  must remain side-effect free.
- **Strict types.** `npm run typecheck` must pass with no errors.
- **No secrets, no real data.** Sample data must be synthetic. Never commit `.env`.

## Good first contributions

- **New data-source adapters** (e.g. MySQL, SQLite, a REST source) behind
  `BrainDataSource`.
- **New example domains** (healthcare, legal, real estate) as alternate
  `domain/types.ts` + `adapter` + seed sets.
- **A recursive-CTE or Apache AGE graph backend** behind the existing graph
  functions.
- **Docs** — clarity improvements are real contributions.

## Pull request checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (add tests for new behaviour)
- [ ] No secrets, no real/personal data
- [ ] Docs updated if behaviour or interfaces changed
- [ ] Commit messages follow `type: summary` (feat / fix / docs / refactor / test / chore)

## How changes flow

1. Open an issue describing the change (for anything non-trivial).
2. Fork, branch, implement with tests.
3. Open a PR referencing the issue. Keep PRs focused.

By contributing you agree your work is licensed under the project's [MIT License](./LICENSE).
