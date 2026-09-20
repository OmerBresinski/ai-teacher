# Homepage

Follow the root AGENTS.md. This is a static website, separate from the React application, served
under `/homepage/` by its existing Vercel project. Preserve the supplied design and authored copy
unless the user requests a change. No Impeccable skill: the user explicitly prohibited it.

Edit `src/` and assets, never generated `dist/`. Read README.md for source ownership, the route
list and the example-lesson manifest pipeline. Read `infra/README.md` for hosting changes; Vercel
configuration remains in `apps/web/vercel.json` (ADR 0010). Do not add a Railway runtime for this
static site. Keep homepage URLs inside the configured prefix and run `homepage:check` and
`homepage:lint`. UI changes require real browser verification. Update this README and
`infra/README.md` alongside deployment changes; product decisions stay in Linear.
