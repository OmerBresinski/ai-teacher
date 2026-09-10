# Gather homepage

This is the existing Gather / Good Company website migrated from
`teachdeck/landing-lab/gather/site`, with its original visual design, authored examples and
motion preserved. It is independent static HTML/CSS/JavaScript, with no backend calls.

## Commands

From the repository root:

```sh
bun run homepage:dev    # build, check, then http://localhost:4186/homepage/
bun run homepage:check # build 27 pages and validate links, assets, anchors and preview markers
bun run homepage:lint  # root Biome conventions; vendored GSAP excluded
bun run homepage:stage # after a web build: copy homepage output into apps/web/dist/homepage
```

`PORT=4187 bun homepage/serve.mjs` selects another local port. The default URL prefix is
`/homepage`; `bun homepage/build.mjs --base=/` builds for a domain root if needed (pass the same
`--base=/` to `check.mjs` and `serve.mjs`). The existing Vercel integration always uses `/homepage`.
Output is in ignored `homepage/dist/`; never edit or commit generated HTML. No installation or
network call is required to build this site. Scripts also work with Node.

## Source ownership

- `src/components.mjs`: shared navigation, footer, characters and page shell.
- `src/pages/{home,features,examples,information,supporting}.mjs`: page copy and markup. Examples
  are canonical authored data, reused by home/features so excerpts stay consistent.
- `assets/`: styles, accessible example interactions, preview form behaviour, font and favicon.
- `motion/`: original character artwork and animation. `vendor/gsap.min.js` is the original
  GSAP 3.14.2 distribution with its copyright/license header retained. Do not hand-edit it.
- `lesson-building/`, `loading-refined/actions.js`, `production/production.js`: the embedded,
  simulated lesson animation. It is not the app's generation pipeline.
- `config.mjs`, `build.mjs`, `check.mjs`, `stage.mjs`: URL prefix, generation, link checks and
  staging into the existing Vite output. `serve.mjs` is local-only.

Gabarito's license is in `assets/gabarito-OFL.txt`. Biome formatting and non-behavioural lint
fixes make the imported source reviewable. Existing CSS specificity and `!important` declarations
are retained to preserve rendering (Biome reports warnings).

## Deployment and verification

The existing `teaching-journey-web` Vercel project remains rooted at `apps/web`. Its build runs
`homepage:stage` after the Vite build. Production is
<https://teaching-journey-web.vercel.app/homepage/> when the reviewed PR is merged and deployed.
No additional Vercel project, Railway service or secret is involved. PR previews retain the
repository's existing disabled policy. `apps/web/scripts/vercel-ignore-build.sh` includes
`homepage`, and CI checks homepage source and generated links.

The `/homepage` redirect adds a trailing slash; the homepage namespace is excluded from the SPA
rewrite. Real files and directory indexes are served directly; the authored 404 is staged as
`apps/web/dist/404.html` so missing homepage URLs return 404. All app routes outside this namespace
keep their existing rewrite and security headers. Only the embedded lesson animation receives
`SAMEORIGIN` framing permission. Homepage assets use revalidation rather than immutable caching.

Before landing, verify the homepage and a nested example, the embedded animation, mobile menu,
example tabs/printing and an unknown URL. The config regression tests cover SPA isolation,
framing, preview indexing and cache policy. `apps/web/e2e/homepage-preview.spec.ts` checks both
forms with JavaScript enabled/disabled, including mouse clicks, Enter and a request audit. After deployment, verify the same URLs and run the
repository's production smoke check.

## Preview and release boundaries

The supplied copy describes intended capabilities. The main action opens an authored sample.
No accounts, uploads, AI requests, PowerPoint generation, form delivery or mailing-list storage
are connected. Submit buttons start disabled and only become active after the local validation
handler is registered. Without JavaScript, a visible explanation replaces that interaction and
both button clicks and Enter leave details unsent. Valid forms explicitly say nothing was sent or saved. Printing the authored
worksheet or answer sheet does work. Review corrections are illustrative, not live AI checks.

The policy pages preserve unresolved production details rather than inventing legal text or
service providers. All pages remain `noindex,nofollow`, including a Vercel header. Deployment
does not constitute product launch approval. Release conditions, verified capabilities, operator
details, final policies, domain and real forms/accounts still need founder decisions.

Product decisions and PRDs belong in Linear; engineering setup lives here and in
`infra/README.md`. Update source, relevant docs and checks together when changing routes,
behaviour or deployment. Do not treat this migration as approval to redesign or rewrite claims.
