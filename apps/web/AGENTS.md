# AGENTS.md — `apps/web` (`@tj/web`)

Vite + React SPA. Client-rendered only; the API is a separate service (`apps/api`, ADR 0005).
Read the root [`AGENTS.md`](../../AGENTS.md) first. Scaffolded by TEACH-21.

## Skills to load (in `./.agents/skills/`)

| Skill | Load when… |
| ----- | ---------- |
| `tanstack-router` | routes, loaders, search params, navigation, code splitting |
| `tanstack-query` | queries, mutations, cache keys, invalidation, prefetch in loaders |
| `shadcn` | composing UI from `@tj/ui`; understanding shadcn component APIs |
| `vercel-react-best-practices` | writing or reviewing React for performance/bundle size |

## Constraints that override the skills

- **ADR 0004 — code-based TanStack Router routes.** Routes are TypeScript objects built with
  `createRootRouteWithContext` / `createRoute`, colocated under `src/routes/` (one file per route
  group) and assembled into `routeTree` in `src/router.tsx`. **Do NOT install
  `@tanstack/router-plugin` / `@tanstack/router-cli`, do NOT use file-based routing, and ignore the
  skill's "use file-based routing" recommendation.** Use `lazyRouteComponent` for route-level
  splitting. Route loaders prefetch through the TanStack Query client passed in router context.
- **ADR 0009 — consume `@tj/ui`.** Import components from `@tj/ui`; **never run `shadcn add` in
  this app** or copy component source here. Missing component → add it in `packages/ui` (see
  `packages/ui/AGENTS.md`). Theming is `data-theme` on `<html>`.
- **Bundle budget: 250 KB gzipped initial bundle (F18-R05)**, enforced in CI (TEACH-23), plus a
  pinned ceiling per editor route chunk (`scripts/check-bundle-budget.ts` `BUNDLE_CHUNK_BUDGETS`,
  ADR 0022 §8; the table is in `README.md` "Bundle budget"). Check `vite build` output before
  adding dependencies; prefer route-level lazy loading.
- ADR 0012: generation progress arrives over SSE (`EventSource`); on events, update the activity
  tray store and invalidate the relevant TanStack Query keys. Client → server actions are normal
  HTTP requests through the typed `@tj/api-client` (`hc<AppType>`), never `fetch` by hand.
- ADR 0010: deploys to Vercel as a static build with an SPA rewrite (`/* -> /index.html`); the API
  origin comes from an env var validated in `src/env.ts` (Zod, ADR 0015). No server code here.
- Library data comes from the documents API through `src/lib/library.ts` (ADR 0024 §9; ADR 0020
  is superseded): `libraryQueries.documents(kind, { sort, q })` and `series()` are infinite queries
  over `GET /documents` (`librarySelectors.items` / `.count` flatten the pages; counts are "loaded
  so far", the API has no totals), `document(id)` is the editor's working copy with its row state
  in `documentMeta(id)`, and every `libraryMutations.*` is a whole-document `PUT` with
  `expectedUpdatedAt`; rename, delete and the series membership writes are optimistic
  (`lib/library-optimistic.ts` edits every cached page in `onMutate`, rolls back in `onError`,
  reconciles in `onSettled`). Screens never call `api.documents` themselves. Route loaders warm
  only the list a page reads and never depend on `q` — the search box writes the URL per
  keystroke and the page's 250 ms debounce owns the fetch. A `409` arrives as
  `ApiError.reason` (`stale` → `useSaveWithConflictToast` offers Reload; `generating` →
  `GeneratingLesson` renders the generating shell over SSE). Unit tests stub the transport with
  `src/test/fake-api.ts` (`installFakeApi()`), seeded with `demoWorkspace()` under its keys
  (`demo-water-cycle`, `series-romans`, …) as ids.
- `vercel-react-best-practices` includes Next.js-specific advice (RSC, `next/*`); it does not
  apply — this is a Vite SPA.
- Tests: `bun test` + React Testing Library + happy-dom; Playwright in `e2e/` (ADR 0014). Biome
  `a11y` rules are errors. No new e2e test unless an absolutely critical flow ships
  (`docs/testing.md`, "Which level a test belongs at"); the suite keeps the critical journeys only
  (cut to 106 tests on 8 Oct 2026). Specs: `auth` (magic link, and "Continue with Google" against an
  api with Google off: `playwright.config.ts` blanks `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`,
  which Bun would otherwise load from `apps/api/.env`; TEACH-31), `session-isolation`,
  `signed-out-first-lesson`, `library` (shell, cards, dialogs, keyboard-only flow, narrow viewport),
  `series`, `viewer`, `present`, `present-one-click`, `present-refit`, `editor` (opens, navigator
  reorder, rename autosave), `editor-text` (Escape commits one undo step, an AI text turning the
  teacher's, toolbar Bold), `editor-images` (upload and Pexels search; `page.route` mocks
  `/images/search`, `/images/pick` and `/files/**`, never the network; fixture PNG in
  `e2e/fixtures/`), `export`, `export-pptx-png`, `export-docx`, `worksheet-print` (pages, header and
  footer; `?auto=1` prints once, `window.print` stubbed in `addInitScript`), `worksheet-editor` (a
  typing burst as one undo step and its autosave, `/` → slash menu → Question, Print opening
  `/print?auto=1` in a new tab via `page.context().waitForEvent("page")`), `worksheet-create`,
  `worksheet-recipes`, `worksheet-library`, `teach-195` (the answer key), `handoff` (TeachDeck's
  `MONOREPO-HANDOFF.md` full pointer flow for the editor, TEACH-113: open → edit text → drag →
  resize → undo/redo → theme → layout → image → present → overview → back), `jobs`,
  `homepage-launch`, `rich-text-safety`, `kit` (opt-in, `E2E_KIT=1`). Some journeys run an axe scan
  (`e2e/a11y.ts`); the per-route a11y suite was removed on 8 Oct 2026. `src/router.test.ts` pins the
  registered route set; `packages/ui/src/styles/contrast.test.ts` pins token contrast.
  Workspaces start empty (ADR 0024 §16): `signedInPage` signs in through the api
  (`signInByApi`, no confirm page), seeds `demoWorkspace()` through `POST /__test/seed-library`, opens
  `/` once and hands back `ids` / `paths` (`paths.lesson("demo-water-cycle")`,
  `paths.key(uuid)`); `test.use({ seed: false })` opts a spec out. Ids are server-minted uuids, so
  no spec hard-codes a document path. `editor-generating` covers the locked lesson (the generating shell, no
  editor, one skeleton rail row per `facts.outline` entry still to come, axe in the three themes)
  and the brief → `/l/:id` flow;
  `teach-169-screenshots` (opt-in, `TEACH_SCREENSHOTS=1`) captures that rail mid-generation; `teach-252-screenshots` (opt-in) the shell with an earlier slide chosen — the finished thumbs are buttons the canvas follows (TEACH-252). `teach-31-screenshots` (opt-in) `/sign-in` and its Google not-set-up alert; `teach-252-sign-in-screenshots` (opt-in) the DayBack `/sign-in` at 1440 in the three themes, a 390 phone, the sent state and `?error=INVALID_TOKEN`. `/sign-in` (TEACH-252) is one page for sign in and sign up, laid out like the homepage hero: one alert slot (sign-out notice, then send error, then Google start error, then `?error=`), legal links to `/homepage/terms/` and `/homepage/privacy/`, and the brand artwork in `components/brand/`: `DaybackMark` and the cast, the homepage hero's four characters around the card (`cast-artwork.tsx` converted from `homepage/src/hero-artwork.mjs`, `cast-rig.ts` a port of `hero-motion.js` plus gaze, smile and hop from `motion/cast.js`, mounted by `sign-in-cast.tsx`). The page passes the cast a mood (`idle`, `typing`, `sending`, `sent`, `error`, `leaving`) and what to look at; it is the first caller of `loadGsap()` (ADR 0028), and with reduced motion GSAP is never fetched and only the faces change. e2e: `sign-in-cast` (arrival, read-along, celebration, reduced motion).
  `generation` runs a lesson end to end over the fake
  worker (`playwright.config.ts` sets `AI_FAKE_SCRIPT=pipeline` and `AI_FAKE_DELAY_MS=250` on the
  e2e worker, so `POST /lessons` really generates — banner, slides arriving before the terminal
  event, the editor taking over in place, the residual footer, the Worksheet link, Stop). Screenshot
  specs: `teach-<n>-screenshots` (opt-in, `TEACH_SCREENSHOTS=1`; `teach-133` is the generating
  view and the finished editor with its residuals; `teach-134` the facts panel, the cascade toast
  and the regenerate dialog). `proposals` (TEACH-134) seeds `generatedLesson()` + its worksheet
  (worksheet first, so the lesson's `artefacts.worksheetId` is the minted uuid) and, on the fake
  worker, edits an objective → cascade toast → Undo, and regenerates slide 3 with an instruction;
  the fake answers cascade/regenerate calls with the fixture spec of the kind the prompt names
  (`apps/worker/src/fake-ai.ts`).
- Client storage keys: `tj:sidebar-collapsed`, `tj:library:sort`, `tj:library:view`, and
  `tj:last-shell` are the stable browser preference/session contracts for the library shell;
  `tj:navigator` (full / compact rail) is the editor's; `tj:brief:last-class` (subject, year
  group, theme of the last lesson planned; `lib/brief-memory.ts`) is the brief's.
- `/lessons/new` is the lesson brief (`lesson-brief.route.ts` + `lesson-brief.page.tsx`, F01 item 2):
  one form validated by `CreateLessonSchema` from `@tj/domain/documents` (the same schema
  `POST /lessons` runs, so the identifier guard reads the same), the two clarifying questions from
  `lib/brief-questions.ts` (product copy lives only there; asked one at a time, the suggestion
  marked with `StatusPill`, Enter accepts — TEACH-177), `libraryMutations.createLesson` →
  `seedGeneratingLesson` (the new lesson and its lock go into the cache first, so `/l/$lessonId`
  paints before its first GET) → `/l/$lessonId`. The form model is `lib/brief-form.ts`, the
  presentational pieces `components/brief/*` (`action-bar.tsx` is the sticky "Plan it" bar, a
  candidate for `@tj/ui`; `theme-tiles.tsx` draws the title slide per theme with `LessonThumb`).
  Subject, year group and theme are remembered per browser (`lib/brief-memory.ts`). "New lesson"
  in the library navigates here (and preloads the chunk on hover); `NewDocumentDialog` stays only
  for the page's "Blank lesson" action (the only blank-lesson entry point). Unit:
  `lesson-brief.page.test.tsx` (focus, prefill, the guard, the materials dialog); e2e: `brief`
  spec (planning and uploads end to end); `teach-177-screenshots` (opt-in) captures the brief;
  `/lessons/new` is in the a11y route list.
- `/worksheets/new?lesson=<id>` is the worksheet creation flow (`worksheet-create.route.ts` +
  `worksheet-create.page.tsx`, TEACH-184): Source (recent lessons, a search box, Blank) then Kind
  (the nine recipes as live miniatures built from the lesson's facts, or `DEMO_LESSON_FACTS` with
  a hint when it has none; six job chips; one Suggested pill from `suggestRecipe`; the tier row
  with Core only). The pure half (reducer, rule, `worksheetFromRecipe`) is `@tj/editor`
  `model/worksheet-creation.ts`; `RecipeCard` is the Add block dialog's card, exported from
  `@tj/editor/worksheet-editor`. Continue posts the built sheet through
  `libraryMutations.createWorksheet` and opens `/w/$worksheetId`. Blank makes `starterWorksheet`
  with the class from `lib/brief-memory.ts`. "New worksheet" in the library and Home's tile, and
  the lesson editor's "Worksheet" action (`?lesson=`), all come here. Sheet headers call
  `estimateMinutes` and cards `minutesForMarks` (`@tj/editor/worksheet-metrics`), the same
  rate and rounding, so a sheet of questions reads the same in both. Unit:
  `worksheet-create.page.test.tsx` (Source, Kind, the keyboard path, example facts); e2e:
  `worksheet-create` spec (rows 4 and 6 into the real editor, axe on both steps);
  `teach-184-screenshots` (opt-in); `/worksheets/new` is in the a11y route list.
- Document routes: `/l/$lessonId` is the editor (`lesson-editor.page.tsx`, `LessonEditor` from
  `@tj/editor/lesson`), `/l/$lessonId/view` the read-only viewer, `/l/$lessonId/present` present
  mode (`?from=edit|view` decides where exit lands). Each page imports `@tj/editor/styles/editor.css`.
  `/w/$worksheetId` is the worksheet editor (`worksheet-editor.page.tsx`, `WorksheetEditor` from
  `@tj/editor/worksheet-editor`; imports `@tj/editor/styles/worksheet-edit.css`; Print →
  `window.open(worksheetPrintHref(id), "_blank", "noopener")` after the autosave flush).
  `/w/$worksheetId/print` is the worksheet print layout (`worksheet-print.page.tsx`, `WorksheetPrint`
  from `@tj/editor/worksheet`, `?auto=1` validated by `worksheetPrintSearchSchema` — the parser
  decodes `1` to a number, so the schema accepts both); it imports `@tj/editor/styles/print.css`
  instead, and renders no AppBar/sidebar/Toaster (ADR 0023 §2). A document opened on the other
  kind's route renders `components/wrong-kind-page.tsx` (title, "This is a lesson/worksheet", a
  link to the right route) — every document page narrows with `kindOf` + `"blocks" in` /
  `"slides" in` before mounting the editor.
