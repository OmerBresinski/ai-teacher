<!-- Title must be a Conventional Commit (it becomes the squash-merge subject), e.g.
     `feat(api): stream Journey generation progress (TEACH-42)`. CI lints it. -->

## Summary

<!-- What changed and why, in two or three sentences. Link the design/ADR if there is one. -->

## Linear ticket

TEACH-

## Checklist

- [ ] **ADR** — architectural decision? Added/updated `docs/adr/NNNN-*.md` and its index, or n/a.
- [ ] **Env vars** — new variable? Added to the relevant `.env.example` *and* checked by `bun run doctor`, or n/a.
- [ ] **Tests** — added/updated unit, integration or e2e tests for the change (ADR 0014), or explained why not.
- [ ] **`bun run verify-bootstrap`** passes locally (install, lint, typecheck, build, commitlint).
- [ ] **Bundle budget** — `apps/web` change? `bun run check:bundle-budget` stays under 250 KB gzip (F18-R05), or n/a.
- [ ] **Docs** — README / `AGENTS.md` / `docs/glossary.md` updated where behaviour or vocabulary changed, or n/a.

## Notes for the reviewer

<!-- Screenshots, follow-ups, anything gated or deliberately left out. -->
