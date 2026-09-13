# DayBack homepage

The DayBack marketing site: independent static HTML/CSS/JavaScript with no backend calls, built
from `src/` by a small Node/Bun script. It has eleven routes and sells one flow — a brief goes in,
a whole lesson comes out — and hands the visitor's topic to the application.

## Commands

From the repository root:

```sh
bun run homepage:dev    # build, check, then http://localhost:4186/homepage/
bun run homepage:check  # build 11 pages and validate routes, links, assets, anchors and strings
bun run homepage:lint   # root Biome conventions; vendored GSAP excluded
bun run homepage:stage  # after a web build: copy homepage output into apps/web/dist/homepage
```

`PORT=4187 bun homepage/serve.mjs` selects another local port. The default URL prefix is
`/homepage`; `bun homepage/build.mjs --base=/` builds for a domain root if needed (pass the same
`--base=/` to `check.mjs` and `serve.mjs`). `--app=https://…` overrides the application origin the
hero posts to; it must be an absolute https URL and defaults to `https://app.bresinski.org`.
`--allow-provisional` lets the build emit an example lesson whose assets are stand-ins. Output is
in ignored `homepage/dist/`; never edit or commit generated HTML. No installation or network call
is required to build this site. Scripts also work with Node.

The visual rules are in `DESIGN-SYSTEM.md`; `REVIEW.md` records what has been verified.

## Routes

`/`, `/examples/`, one `/examples/<slug>/` per emitted lesson, `/help/` (nav label "FAQ"),
`/about/`, `/trust/`, `/privacy/`, `/terms/`, `/cookies/`, `/accessibility/`, `/404/`.
`check.mjs` asserts that exact set and fails on any reference to a route the launch cut removed.

## Source ownership

- `src/components.mjs`: shared navigation, footer, characters and page shell, plus `href()` for
  internal links and `appHref()` for links into the application. Decorative diagonal arrows use
  `arrowIcon` SVG artwork so browser emoji fonts cannot replace them.
- `src/pages/{home,examples,information,supporting}.mjs`: page copy and markup. `home.mjs` holds
  the hero form and the home sections, `examples.mjs` renders the lesson pages from manifests,
  `information.mjs` the FAQ, about, "AI and your data" and 404 pages, `supporting.mjs` the privacy,
  terms, cookie and accessibility notices.
- `src/examples-data.mjs`: reads the example manifests and decides which lessons the build emits.
- `assets/`: styles, hero motion, font and favicon.
- `assets/examples/<slug>/`: one folder per example lesson (see below).
- `motion/`: original character artwork and animation. `vendor/gsap.min.js` is the original
  GSAP 3.14.2 distribution with its copyright/license header retained. Do not hand-edit it.
- `config.mjs`, `build.mjs`, `check.mjs`, `stage.mjs`: URL prefix, application origin, generation,
  route and string checks and staging into the existing Vite output. `serve.mjs` is local-only.

Gabarito's license is in `assets/gabarito-OFL.txt`. Existing CSS specificity and `!important`
declarations are retained to preserve rendering (Biome reports warnings).

## The example-lesson pipeline

An example lesson is data, not code. Each lives in `assets/examples/<slug>/` as exported images
plus a `manifest.json`:

```json
{
  "year": "Year 4",
  "subject": "science",
  "title": "How sound travels",
  "brief": "Year 4 science, how sound travels",
  "provisional": true,
  "slides": [{ "src": "slides/01.png", "alt": "Slide 1: …" }],
  "worksheet": {
    "pages": [{ "src": "worksheet/01.png", "alt": "…" }],
    "answers": [{ "src": "answers/01.png", "alt": "…" }]
  }
}
```

Slides are PNG, 1440 wide at most, and every slide needs real `alt` text or the build throws. A
worksheet page may also be a bare path string, in which case a positional alt is generated. The
build skips a lesson with no slide or worksheet assets and logs why, so the index only ever lists
lessons whose images exist, and the headings and counts on home and `/examples/` follow the number
of lessons actually emitted. A manifest marked `"provisional": true` carries stand-in assets and is
emitted only with `--allow-provisional`. Dropping real exports into the folder and removing that
flag is the whole swap.

## Deployment and verification

The existing `teaching-journey-web` Vercel project remains rooted at `apps/web`. Its build runs
`homepage:stage` after the Vite build. No additional Vercel project, Railway service or secret is
involved. `apps/web/scripts/vercel-ignore-build.sh` includes `homepage`, and CI checks homepage
source and generated links.

The `/homepage` redirect adds a trailing slash; the homepage namespace is excluded from the SPA
rewrite. Real files and directory indexes are served directly; the authored 404 is staged as
`apps/web/dist/404.html` so missing homepage URLs return 404. All app routes outside this namespace
keep their existing rewrite and security headers. Homepage assets use revalidation rather than
immutable caching.

`apps/web/e2e/homepage-launch.spec.ts` covers the hero form with JavaScript on and off, the upload
link, navigation, an example page's images, 390 overflow, page errors and axe on four routes. The
`apps/web` config regression tests cover SPA isolation, framing, indexing and cache policy. Before
landing, verify the home page, an example lesson, the mobile menu and an unknown URL in a browser.

`noindex,nofollow` and the Vercel `X-Robots-Tag` header are still in place; the launch-config
ticket removes them together with the domain change. Product decisions and PRDs belong in Linear;
engineering setup lives here and in `infra/README.md`. Update source, relevant docs and checks
together when changing routes, behaviour or deployment.
