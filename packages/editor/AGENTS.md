# AGENTS.md — `packages/editor` (`@tj/editor`)

The lesson and worksheet editor, read-only viewer, present mode and exporters, ported from
TeachDeck (`gregjwa/pres-ui-temp` at `f3dbcf7`) and consumed by `apps/web` on the `/l/*` and
`/w/*` routes. Read the root [`AGENTS.md`](../../AGENTS.md) first. Decisions: ADR 0021 (document
contract), ADR 0022 (this package), ADR 0023 (exports). The TeachDeck repo is the behavioural
reference; nothing is pasted from it without reading the file it came from.

## Skills to load (in `./.agents/skills/`)

| Skill | Load when… |
| ----- | ---------- |
| `shadcn` | composing `@tj/ui` primitives (Dialog, DropdownMenu, Popover, Tooltip, Tabs, Switch, Slider…) inside editor chrome. **Components are added in `packages/ui` only (ADR 0009); this package never runs the shadcn CLI.** |
| `vercel-react-best-practices` | writing or reviewing any component here: re-renders, bundle size, lazy boundaries. Next.js sections do not apply (Vite SPA). |

## Constraints that override the skills

- **ADR 0022 §2 — the twin rule.** Where `@tj/ui` has a Radix twin, use it. The editor kit
  (`src/kit/`) holds only geometry-owning chrome with no twin (Panel, Segmented, NumberInput,
  ZoomControl, Rail, Color, SaveIndicator, InlineTitle). TeachDeck's `components/ui2/floating.ts` is
  never ported: Radix owns the one floating layer. A `@tj/ui` surface opened from the present-mode stage carries
  `className="tj-stage"` (`tooltipClassName` / `contentClassName` on `IconButton` / `Tooltip`).
- **ADR 0022 §4 — TanStack Query is the only store.** No `zustand`, `zundo`, `immer`-as-store or
  `idb-keyval`. The document lives in the Query cache under the key the app passes in; edits are
  pure reducers in `src/model/reducers/` applied through `useDocumentHistory` (lessons) and
  `src/worksheet/reducers/` applied through `useWorksheetHistory` (worksheets); both are thin
  wrappers over the one generic `src/model/use-history.ts`. A reducer is
  `(lesson, ...args) => Lesson` or `=> { lesson, id }`; it returns the *same* object for a no-op
  (the hook treats identity as "nothing changed") and `silent(...)`-marked reducers
  (`setFitVersion`, `updateElementLayout`) write without an undo step. Transient UI state
  (selection, zoom, drag deltas, ink, timer) is React state and refs; pointer moves write refs and
  commit one reducer on release. In the lesson editor that state is `use-editor-session.ts`;
  in the worksheet editor it is `worksheet/use-worksheet-session.ts` (selection, the block whose
  Tiptap editor is mounted, where its caret should land)
  (`useReducer` + split contexts, read with `useSelection`/`useActiveSlideId`/`useZoom`/
  `useSessionUi`, written through `useSessionActions`), the document is reached through
  `document-context.ts` (`useLesson`, `useHistory`), and a drag paints `SlideView` from a
  `transformOverride` preview map until pointer-up dispatches `transformElements` once. Element
  renderers reach the document only through `slide/editor-hooks.ts` (`EditorHooksContext` for the
  stable write functions, `EditingStateContext` for `editingTextId`/`editingExplanation`), which
  `LessonEditor` provides; the Tiptap editors (`EditableText`, `EditableLabel`, `LabelEditor`,
  `ExplanationEditor`) are `React.lazy` behind `mode === "edit"`, write every keystroke through
  `useEditSession` (one transaction per typing burst, closed after 500 ms idle or on blur), and
  register with `text/active-editor.tsx` so the text toolbar can drive the caret. Renderer paths
  (`view`, `present`, `capture`, `thumb`) never see any of it.
- **ADR 0021 — documents come from `@tj/domain/documents`.** Never redeclare `Slide`, `Lesson`,
  `Worksheet`, `Theme`. The theme *catalogue*, grid, layout recipes and doc builders live in
  `@tj/slides` (ADR 0025 §9) and are re-exported from `src/model/*`; starter content and
  `insert.ts` stay here.
- **ADR 0013 — never import `apps/*`.** Internal dependencies are `@tj/domain`, `@tj/slides`,
  `@tj/ui`, `@tj/config`. Never import `packages/slides/src/...` by relative path. Bun's isolated linker: every import is declared in `package.json`, versions exact.
- **No Next.js.** `next/link` → TanStack `Link` (in `apps/web`, via callbacks here), `next/font` →
  `@fontsource` (`src/styles/fonts.css`), `next/dynamic` → `React.lazy`, no `'use client'`.
- **Bundle (ADR 0022 §8).** `./thumb` must never pull Tiptap's React editor or any editing module
  (`src/thumb.test.ts` builds it and checks). Exporter libraries are `await import()`ed on click.
- **React conventions the reviewer enforces:** no `useEffect` for derived state (only external
  subscriptions: ResizeObserver, fonts, keyboard, fullscreen); `memo` only with stable props;
  Biome `a11y` at `error` — every icon-only control has a label. Named exports only.
- Package shape follows the README ("Internal packages are consumed from source"): `exports` point
  at `src/*`, `sideEffects` lists CSS only, `tsconfig.json` extends `@tj/config/tsconfig/react.json`,
  tests run with `bun test` + React Testing Library + happy-dom (ADR 0014); `bun-test.setup.ts`
  adds `ResizeObserver` and `PointerEvent`.

## Layout

```
src/
  model/      themes, fonts, grid, factories, layouts, geometry are one-line re-exports of
              `@tj/slides` (ADR 0025 §9); insert (element factories), reducers/ (pure lesson
              reducers, immer inside), use-history (the one undo/redo/transactions implementation
              over the Query cache, generic in the document type), use-document-history (its
              `Lesson` wrapper), use-edit-session (one undo step per gesture/typing run),
              use-autosave (generic over `Lesson | Worksheet`; both top bars read it),
              worksheet-factories, demo-worksheet
  text/       Tiptap extension set + static HTML rendering (renderDocHTML)
  images/     image-search (Openverse mapping + `searchOpenverse`/`fetchRemoteImage`, pure; no
              Tenor, no `process.env`), images (`fileToDataUrl` downscale, `isImageFile`)
  slide/      SlideView (the one renderer), SlideScaler, SlideStatic, elements/*
  kit/        Panel, Segmented, NumberInput, ZoomControl, Color, Rail, SaveIndicator (the live
              region over the autosave store), InlineTitle (the h1 that renames) — no @tj/ui twin
  layout/     text fitting engine: reflow/lint/fit-plan (pure), measure (DOM ruler), tidy
              (pure over the lesson; `tidySlideReducer` for dispatch), use-slide-lint (navigator
              badge), use-fit-migration (once per lesson on open); `test-ruler.ts` is the fake
              Measurer the tests use — happy-dom cannot lay out text
  text/       Tiptap extensions, static HTML, doc-marks/links (pure), active-editor context
  present/    LessonViewer, PresentView and present-mode pieces (`@tj/editor/present`)
  worksheet/  `@tj/editor/worksheet`: pure modules (metrics, paginate, answers, word-search — TeachDeck
              `lib/worksheet/*`), reducers/ (pure worksheet reducers; `edit` renumbers questions),
              use-worksheet-history (the `Worksheet` wrapper over `model/use-history`), the static
              renderer (Sheet, BlockContent, WordSearch, block-types), measure (off-screen column +
              ResizeObserver → `useSheetPagination`; the one external subscription — it ignores
              reports taken while `display: none` under `@media print`) and WorksheetPrint
              (`?auto=1` → `window.print()` once, after `whenFontsReady` and two frames).
              `@tj/editor/worksheet-editor` (`editor-index.ts`, its own entry so the print chunk
              never pulls Tiptap): WorksheetEditor shell (block-row actions over refs, split /
              merge / slash intents, the ⌘Z window handler), worksheet-context (four contexts:
              worksheet, history API, typing session, UI session; `useBlockWrites` = `patch`
              inside the typing session / `commit` as its own step), typing-session (over
              `useEditSession`; `undo`/`redo` close the open session first), use-worksheet-session,
              use-block-drag (pointer refs, one `moveBlock` on release), BlockShell (memoised row:
              gutter + / handle, ring, oversize warning; `lazy()`-loads BlockTextEditor),
              BlockTextEditor (the one mounted Tiptap; `block-extensions` = base set with
              `undoRedo: false` — the cache is the only history), EditableBlocks (`SheetField`
              contentEditable spans laid out as the printed text, so measured heights hold),
              EditableHeader + HeaderToolbar (rules, objective, criteria, paper, key, RAG),
              SlashMenu (`@tj/ui` Popover on a virtual anchor; combobox + listbox), toolbar/
              (BlockToolbar routes to Question / WordSearch / AnswerSpace / Layout, one file per
              family; shared NumberField + LinesPopover), WorksheetTopBar
  lesson/     LessonEditor shell (`@tj/editor/lesson`): TopBar, InsertRail, Navigator, Canvas,
              canvas/ (SlideActions, SlideTabs, placement), transform/ (SelectionLayer, keys,
              hit-test, resize), toolbar/ (ContextualToolbar routing + placement; one file per
              bar: Text, Shape, Line, Image, Other, Multi, Slide, AnswerDrawer, MoreDrawer; shared
              DropTrigger/useElementWrites), insert/ (IconPicker, LessonInfo), InsertRail,
              AddImagePanel (Upload / Photos popover; open state and replace target are session
              `imagePanel`), image-source (file/stock → `ImageSource`, `imageFields`),
              canvas/use-image-drop (paste + drop listeners), ThemeDialog, use-editor-session,
              slide-commands, keys, shortcuts; residual-findings (`residualFindings(lesson,
              worksheet)` = stored model findings + live `checkLesson`, deduped; the context
              `LessonEditor` fills on the autosave cadence — 800 ms after a change, never per
              keystroke), SlideBadge (the one navigator dot: the layout lint and the residuals both
              use it, `data-lint-badge` / `data-residual-badge`, `data-tone`), ResidualBadge (the
              canvas footer's "N things to check" popover with Go to slide; a `budget` finding is
              listed first). `LessonEditor` takes the app's `worksheet` and `onOpenWorksheet`
              (TopBar "Worksheet" when `lesson.artefacts.worksheetId` is set) — ADR 0025 §10, §12
  styles/     editor.css = fonts.css + slide.css + present.css; print.css = fonts.css +
              worksheet.css + the print layout (`@tj/editor/styles/print.css`, imported by the
              worksheet print page only); worksheet-edit.css = fonts.css + worksheet.css + the
              editor chrome (gutter, ring, fields, toolbars, drop line — every rule out of flow or
              paint-only, so nothing the measuring column paginates from can move). worksheet.css reads only `--ws-*` variables set by
              `sheetVars()`; its `.ws-rt` rules are scoped under `.ws-sheet` so they beat slide.css's
              `.td-rt` (RichText carries both classes) whatever the import order.
  thumb.ts    the library's thumbnail entry (`@tj/editor/thumb`)
```

Tests that mount the worksheet editor use `src/worksheet/editor-test-harness.tsx`
(`renderWorksheetEditor`, `row(container, id)`); `worksheet-editor.test.tsx` drives the slash menu
(the `+` gutter button; options are picked on `pointerDown`), the toolbars (`spinbutton` by label,
change + blur), the header switches and a handle drag with stubbed `getBoundingClientRect`s.
Tests that mount the lesson shell use `src/lesson/test-harness.tsx` (`renderEditor`): a seeded QueryClient
plus the layout stubs happy-dom lacks (the navigator's `offsetHeight`, so react-virtual renders
rows). A real Tiptap editor does construct under happy-dom (`editor.commands.*` works; typing and
selection do not — those are Playwright's). ProseMirror's contenteditable carries no ARIA role, so
query it as `.ProseMirror`. Floating chrome that has not measured yet is `opacity: 0`, never
`visibility: hidden` — the latter empties every control's accessible name. Radix menus do not open
on `fireEvent.click`: use `keyDown Enter` on the trigger; a menu closing hands focus to its trigger
a tick later, so wait for it before opening a Popover or the popover reads the move as "outside".
A Radix Popover's content stays mounted through its fade-out and reports a pointer down from that
window a tick later — `AddImagePanel` ignores an `onInteractOutside` whose event predates the
current open, or Replace right after an upload would close the panel it opened. Radix Tabs switch
on `mouseDown`+`click`. Search tests stub `globalThis.fetch` (restore it in `afterEach`). Every stylesheet the slide needs travels with the route that paints it: pages in `apps/web`
import `@tj/editor/styles/editor.css` themselves rather than relying on the library chunk.

Tests: `bun test` in this directory. Behaviour tests only; TeachDeck's vitest files are a
catalogue of cases, not ported (ADR 0022 §9).
