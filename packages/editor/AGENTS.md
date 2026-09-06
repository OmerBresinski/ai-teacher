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
  ZoomControl; Rail and Color arrive with TEACH-105). TeachDeck's `components/ui2/floating.ts` is
  never ported: Radix owns the one floating layer. A `@tj/ui` surface opened from the present-mode stage carries
  `className="tj-stage"` (`tooltipClassName` / `contentClassName` on `IconButton` / `Tooltip`).
- **ADR 0022 §4 — TanStack Query is the only store.** No `zustand`, `zundo`, `immer`-as-store or
  `idb-keyval`. The document lives in the Query cache under the key the app passes in; edits are
  pure reducers in `src/model/reducers/` applied through `useDocumentHistory`. A reducer is
  `(lesson, ...args) => Lesson` or `=> { lesson, id }`; it returns the *same* object for a no-op
  (the hook treats identity as "nothing changed") and `silent(...)`-marked reducers
  (`setFitVersion`, `updateElementLayout`) write without an undo step. Transient UI state
  (selection, zoom, drag deltas, ink, timer) is React state and refs; pointer moves write refs and
  commit one reducer on release. In the lesson editor that state is `use-editor-session.ts`
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
  `Worksheet`, `Theme`; the theme *catalogue*, id factories and starter content live here.
- **ADR 0013 — never import `apps/*`.** Internal dependencies are `@tj/domain`, `@tj/ui`,
  `@tj/config`. Bun's isolated linker: every import is declared in `package.json`, versions exact.
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
  model/      themes (catalogue, floors, FIT_VERSION), fonts, grid, factories, layouts, geometry,
              insert (element factories), reducers/ (pure lesson reducers, immer inside),
              use-document-history (undo/redo/transactions over the Query cache)
  text/       Tiptap extension set + static HTML rendering (renderDocHTML)
  layout/     text-fitting engine: reflow, explanation panel (lint/tidy/fit arrive in phase C)
  slide/      SlideView (the one renderer), SlideScaler, SlideStatic, elements/*
  kit/        Panel, Segmented, NumberInput, ZoomControl, Color — chrome with no @tj/ui twin
  text/       Tiptap extensions, static HTML, doc-marks/links (pure), active-editor context
  present/    LessonViewer, PresentView and present-mode pieces (`@tj/editor/present`)
  lesson/     LessonEditor shell (`@tj/editor/lesson`): TopBar, InsertRail, Navigator, Canvas,
              canvas/ (SlideActions, SlideTabs, placement), transform/ (SelectionLayer, keys,
              hit-test, resize), toolbar/ (ContextualToolbar placement, TextToolbar),
              use-editor-session, use-autosave, slide-commands, keys, shortcuts
  styles/     editor.css = fonts.css + slide.css + present.css
  thumb.ts    the library's thumbnail entry (`@tj/editor/thumb`)
```

Tests that mount the shell use `src/lesson/test-harness.tsx` (`renderEditor`): a seeded QueryClient
plus the layout stubs happy-dom lacks (the navigator's `offsetHeight`, so react-virtual renders
rows). A real Tiptap editor does construct under happy-dom (`editor.commands.*` works; typing and
selection do not — those are Playwright's). ProseMirror's contenteditable carries no ARIA role, so
query it as `.ProseMirror`. Floating chrome that has not measured yet is `opacity: 0`, never
`visibility: hidden` — the latter empties every control's accessible name. Every stylesheet the slide needs travels with the route that paints it: pages in `apps/web`
import `@tj/editor/styles/editor.css` themselves rather than relying on the library chunk.

Tests: `bun test` in this directory. Behaviour tests only; TeachDeck's vitest files are a
catalogue of cases, not ported (ADR 0022 §9).
