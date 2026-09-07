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
| `deploy-to-vercel` | Vercel project, preview deployments, environment variables |

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
- **Bundle budget: 250 KB gzipped initial bundle (F18-R05)**, enforced in CI (TEACH-23). Check
  `vite build` output before adding dependencies; prefer route-level lazy loading.
- ADR 0012: generation progress arrives over SSE (`EventSource`); on events, update the activity
  tray store and invalidate the relevant TanStack Query keys. Client → server actions are normal
  HTTP requests through the typed `@tj/api-client` (`hc<AppType>`), never `fetch` by hand.
- ADR 0010: deploys to Vercel as a static build with an SPA rewrite (`/* -> /index.html`); the API
  origin comes from an env var validated in `src/env.ts` (Zod, ADR 0015). No server code here.
- Library data comes from `src/mocks` via `src/lib/library.ts` (ADR 0020); screens never import the
  store directly.
- `vercel-react-best-practices` includes Next.js-specific advice (RSC, `next/*`); it does not
  apply — this is a Vite SPA.
- Tests: `bun test` + React Testing Library + happy-dom; Playwright + axe in `e2e/` (ADR 0014). Biome
  `a11y` rules are errors. Specs: `auth`, `library` (shell, cards, dialogs, keyboard-only flow,
  narrow viewport), `series` (detail page incl. real-pointer drag), `viewer`, `present`, `editor`
  (canvas drag/snap/resize, navigator reorder, autosave, the TeachDeck geometry checks),
  `editor-text` (double-click to edit, Escape commits, toolbar, option label, Why? panel),
  `editor-chrome` (toolbar routing, rail inserts, opacity drag, theme dialog), `editor-layout`
  (lint badge + Tidy; the `electricity` seed is stored at `fitVersion: 0` so the fit migration
  runs once when it is opened), `editor-images` (upload/paste/drop, Openverse search and Replace;
  `page.route` mocks `api.openverse.org` and the image hosts, never the network; fixture PNG in
  `e2e/fixtures/`; the Photos-tab screenshot is opt-in via `TEACH_SCREENSHOTS=1`),
  `worksheet-print` (pages/header/footer, `?auto=1` prints once — `window.print` is stubbed in
  `addInitScript`, `emulateMedia("print")` + `page.pdf()` page count, the lesson-id wrong-kind
  page), `worksheet-editor` (header + blocks + the print route's page count, a typing burst as one
  undo step and its autosave, `/` → slash menu → Question, a real-pointer handle drag, Print opening
  `/print?auto=1` in a new tab via `page.context().waitForEvent("page")`, wrong-kind both ways),
  `a11y` (the ten signed-in library/document routes × the three themes via `page.addInitScript` setting `tj-theme`, plus open dialogs/menus; `/sign-in` and
  `/dev/jobs` once in light), `kit` (opt-in,
  `E2E_KIT=1`). `src/router.test.ts` pins the registered route set; `packages/ui/src/styles/contrast.test.ts`
  pins token contrast. A full reload reseeds the mock library (ADR 0020) — assert persistence through
  client-side navigation.
- Client storage keys: `tj:sidebar-collapsed`, `tj:library:sort`, `tj:library:view`, and
  `tj:last-shell` are the stable browser preference/session contracts for the library shell;
  `tj:navigator` (full / compact rail) is the editor's.
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
