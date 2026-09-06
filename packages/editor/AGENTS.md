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
  (`src/kit/`) holds only geometry-owning chrome with no twin (Panel, Rail, Segmented, NumberInput,
  Color, ZoomControl). TeachDeck's `components/ui2/floating.ts` is never ported: Radix owns the
  one floating layer. A `@tj/ui` surface opened from the present-mode stage carries
  `className="tj-stage"` (`tooltipClassName` / `contentClassName` on `IconButton` / `Tooltip`).
- **ADR 0022 §4 — TanStack Query is the only store.** No `zustand`, `zundo`, `immer`-as-store or
  `idb-keyval`. The document lives in the Query cache under the key the app passes in; edits are
  pure reducers in `src/model/reducers/` applied through `useDocumentHistory`. Transient UI state
  (selection, zoom, drag deltas, ink, timer) is React state and refs; pointer moves write refs and
  commit one reducer on release. Renderer paths (`view`, `present`, `capture`, `thumb`) read
  editor state through `EditorHooksContext` only, which those modes never provide.
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
  model/      themes (catalogue, floors, FIT_VERSION), fonts, grid, factories, layouts, geometry
  text/       Tiptap extension set + static HTML rendering (renderDocHTML)
  layout/     text-fitting engine: reflow, explanation panel (lint/tidy/fit arrive in phase C)
  slide/      SlideView (the one renderer), SlideScaler, SlideStatic, elements/*
  styles/     editor.css = fonts.css + slide.css
  thumb.ts    the library's thumbnail entry (`@tj/editor/thumb`)
```

Tests: `bun test` in this directory. Behaviour tests only; TeachDeck's vitest files are a
catalogue of cases, not ported (ADR 0022 §9).
