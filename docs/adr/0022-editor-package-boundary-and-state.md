# 0022 — `@tj/editor`: package boundary, kit rule, state model and fonts

- Status: Accepted
- Date: 2026-09-06
- Related PRD decisions: TD project items 2 and 6 (package the editor; design-system consumption), F18-R05 (bundle budget), F18-D4 (themes), F18-R09 (WCAG 2.2 AA)
- Related ADRs: 0004, 0013, 0019, 0020, 0021

## Context

TeachDeck's editor surface is about 36k lines: `components/v2/{editor,present,worksheet,export,series}`
(13.4k), the `components/ui2` kit (9.5k), the slide renderer `components/slide` (4.2k), the
transform layer and editor logic under `components/editor` (7.5k, partly v1 chrome the v2 clones
reuse), `components/worksheet` and `components/present` helpers, and `lib/` (12.2k: model, store,
layout, text, worksheet, present, export, snapping, geometry, images, image-search). The v2 clones
are not standalone: they import the v1 renderer, transform layer, shortcuts, insert helpers and
every `lib/` module. It is a Next.js 16 app (`next/font/google`, `next/link`, `next/navigation`,
`'use client'` in 218 files) persisting to IndexedDB through `idb-keyval`, with editing state in
`zustand` + `zundo` + `immer` stores (`lib/store/lesson-store.ts`, 60+ actions,
snapshot-replay transactions; `lib/store/worksheet-store.ts`; `lib/present/present-store.ts`).

Our web app is a Vite SPA with code-based TanStack Router (ADR 0004), TanStack Query as the only
client cache (ADR 0020, which also rules out Zustand and IndexedDB for the library), a 250 KB
gzipped initial-bundle budget, and `@tj/ui` owning the design tokens with shadcn/Radix primitives
(ADR 0019). The four editor routes already exist as stubs (`apps/web/src/routes/editor-stubs.route.ts`)
whose loaders resolve the document through `libraryQueries.document(id)`.

ADR 0019 §5 said the `components/ui2` kit "ships inside `@tj/editor`" and §3 said the present-mode
stage palette "belongs to `@tj/editor`". Reading the kit shows why that would hurt: `ui2/floating.ts`
owns its own portal host and Escape stack, so a `@tj/ui` toast over an editor dialog would be two
floating layers with two dismissal models; and 14 of the 24 ui2 components the editor uses already
have restyled Radix twins in `@tj/ui`.

## Decision

1. **Package.** `packages/editor` (`@tj/editor`) is a React library consumed by `apps/web`. It
   depends on `@tj/ui`, `@tj/domain` and `@tj/config` internally, never on `apps/*` (ADR 0013).
   `package.json#exports` point at source (`./src/index.ts` plus subpaths `./lesson`,
   `./present`, `./worksheet`, `./export`, `./thumb`, `./styles/editor.css`), `sideEffects` lists
   only CSS, every import is declared (Bun isolated linker), versions are exact. Its `AGENTS.md`
   names the skills to load and the constraints below. The TeachDeck repository is the behavioural
   reference, frozen at `f3dbcf7`; it does not build against `@tj/editor` (a deviation from TD item
   2's "done when", recorded on the Linear project for Greg).
2. **Kit rule ("twin rule").** Where `@tj/ui` has a shadcn/Radix twin, the editor uses it: Dialog,
   AlertDialog (for ui2 `ConfirmDialog`), DropdownMenu (ui2 `Menu`), Popover, Tooltip, Toast
   (sonner), Tabs, Switch (ui2 `Toggle`), Checkbox, RadioGroup, Select, Slider (added to `@tj/ui`
   by this project), Kbd, Spinner, Button and IconButton. The editor kit keeps only components with
   no twin that own document geometry or editor chrome: Panel, Rail, Segmented, NumberInput, Color,
   ZoomControl, Deck, Overlay, FadeIn and the stage helpers. `ui2/floating.ts` (portal host, Escape
   stack, `useFloating`) is **not** ported: Radix owns the one floating layer. This supersedes the
   wording of ADR 0019 §5; `@tj/ui` still owns the token variables and the editor paints from them.
3. **Stage scope.** The permanently-dark present-mode palette (`components/ui2/tokens.css`,
   `.v2-stage`) lives in `@tj/ui/src/styles/globals.css` as a **variable scope** `.tj-stage` that
   remaps the shadcn semantic variables (`--background`, `--card`, `--popover`, `--foreground`,
   `--muted-foreground`, `--border`, `--input`, `--primary`, `--ring`, `--destructive`, shadows,
   scrim) to the stage values. It is not a fourth theme and does not paint a background of its own.
   Present mode puts `tj-stage` on its root; `@tj/ui` floating components accept a `className` on
   their portalled content so a menu opened from the stage carries the class (the Radix equivalent
   of ui2 `tone="dark"`). `contrast.test.ts` pins the stage pairs. This supersedes ADR 0019 §3's
   "belongs to `@tj/editor`".
4. **State: TanStack Query is the only store.** `zustand`, `zundo` and `idb-keyval` do not come
   across. The **document** lives in the Query cache under the existing key
   `queryKeys.libraryDocument(id)` and is the single source of truth while editing. TeachDeck's
   store actions become **pure reducers** `(lesson: Lesson, action) => Lesson` in
   `packages/editor/src/model/reducers/` (their bodies are already `immer` `produce` callbacks over
   the document; `immer` stays as a pure helper). A `useDocumentHistory(id)` hook keeps `past` and
   `future` snapshot arrays with structural sharing and applies changes through
   `queryClient.setQueryData`; `beginTransaction`/`endTransaction` become snapshot-before /
   push-after so a drag, a paste or a re-fit is one undo step. **Transient UI state** — selection,
   editing element id, zoom, hover, marquee, drag deltas, present-mode tool/timer/blackout/ink — is
   React state and refs in the editor tree, never in Query; pointer moves write refs at frame rate
   and commit one reducer on pointer-up. Undo scope is the editor session; leaving the route clears
   it.
5. **Loading and saving.** The route loader keeps resolving the document via
   `libraryQueries.document(id)` (`ensureQueryData`, 404 on null); the editor reads the same query.
   The editor owns the autosave debounce (800 ms, TeachDeck's `AUTOSAVE_MS`) and calls an `onSave(doc)`
   prop; `apps/web` wires it to `useMutation(libraryMutations.saveDocument(queryClient))`, which
   writes the mock store today and `PUT /lessons/:id` later, and invalidates `["library"]` on
   success. Save state (`saved` / `unsaved` / `saving` / `failed`) is exposed through a
   `useSyncExternalStore`-backed hook as TeachDeck's `useSaveState` is; a `beforeunload` flush is
   kept. The document query's `staleTime` is long enough that re-entering the editor does not
   refetch under an in-flight save.
6. **No Next.js.** Every `next/*` import has a replacement the tickets name per file:
   `next/link` → TanStack `Link`; `next/navigation` (`useRouter`, `useParams`,
   `useSearchParams`) → `useNavigate`, route `params`, `validateSearch`; `next/font/google` →
   `@fontsource*` (item 7); `next/dynamic` → `React.lazy` / `lazyRouteComponent`; `'use client'`
   is deleted. Route files are not ported; the four existing routes (`/l/$lessonId`,
   `/l/$lessonId/present`, `/w/$worksheetId`, `/w/$worksheetId/print`) plus a new
   `/l/$lessonId/print` (ADR 0023) mount `@tj/editor` components with `lazyRouteComponent`.
   Paths do not change (TeachDeck's `components/ui2/paths.ts` and Greg's print routes share them).
7. **Document theme fonts.** The six slide themes reference eleven families TeachDeck loads with
   `next/font/google` (`lib/fonts.ts`: Lexend, Gabarito, Figtree, Source Serif 4, Schibsted
   Grotesk, Literata, Public Sans, Bricolage Grotesque, Instrument Sans, Atkinson Hyperlegible
   Next, Geist). `@tj/editor` adds the matching `@fontsource` / `@fontsource-variable` packages and
   a `fonts.css` that defines the same `--font-*` variables; it is imported by the editor CSS, so
   it loads with the editor, present and thumbnail chunks and never with the initial bundle. No
   Google Fonts requests; the CSP is unchanged (ADR 0019 §2).
8. **Bundle.** The four routes stay `lazyRouteComponent` chunks. Exporter libraries (pptxgenjs,
   docx, modern-screenshot) are `await import()`ed inside the export action, never statically
   (ADR 0023). Static text rendering (`renderDocHTML` over `@tiptap/html`) is shared by the viewer,
   present mode, print and thumbnails; the Tiptap React editor and ProseMirror view load only with
   the lesson and worksheet editor chunks. `scripts/check-bundle-budget.ts` grows per-chunk
   budgets: the 250 KB initial budget is unchanged and must not include any `@tj/editor` code; the
   consolidated test ticket measures the built chunks and pins ceilings with ~20% headroom
   (starting points: present ≤ 200 KB gz, lesson editor ≤ 450 KB gz, each exporter chunk loaded
   only on click).
9. **Tests.** TeachDeck's vitest files are read as a catalogue of cases but **not ported**; every
   ticket writes its own tests from its acceptance table (`bun test` + happy-dom + RTL for
   components and reducers, Playwright with real pointer events for drag/select/present, axe in
   three themes on every new route). Source-inspection tests (`ui2/__tests__/system.test.ts`,
   `gallery.test.ts`, `tokens.test.ts`, `printed-markup-coupling.test.ts`) have no equivalent;
   Biome and our existing guard tests (`font-display-usage.test.ts`, `contrast.test.ts`,
   `router.test.ts`) cover the intent.

## Consequences

- The port is a rewrite of the state layer and a translation of everything else. The reducers are
  the first phase-C ticket so the model is proven before any canvas UI is built on it.
- One floating layer, one Escape model, one token owner. Two rules to review against: no
  `ui2/floating.ts` import anywhere, no `zustand` in `apps/web` or `packages/editor`.
- `@tj/ui` gains `Slider`, the `.tj-stage` scope and a `className` pass-through on portalled
  content; nothing else in the shell kit changes.
- Eleven font packages (~ a few MB of woff2 on disk, loaded per `unicode-range` on demand) live in
  `packages/editor`; Vercel serves them as static assets.
- ADR 0019 §3 and §5 are amended by this decision; ADR 0020's "no Zustand" now covers the editor
  too. `packages/ui/AGENTS.md` and `apps/web/AGENTS.md` need one line each pointing at
  `packages/editor/AGENTS.md`, added by the skeleton ticket.
- Revisit if the reducer + Query model cannot hold frame rate on a 30-element slide drag in the
  phase-C spike; the fallback is a `useReducer` document inside the editor with Query updated on
  save, not a return to zustand.
