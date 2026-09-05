# `@tj/ui`

Design system for Teaching Journey ([ADR 0009](../../docs/adr/0009-tailwind-shadcn.md)):
Tailwind CSS v4 + shadcn/ui components (Radix primitives), themed by CSS variables and switched
with a `data-theme` attribute on `<html>`. Apps consume this package and **never install shadcn
components directly**.

Tokens are placeholders until F18 (App Shell PRD §7) fills them; the plumbing is what this
package delivers today (TEACH-13).

## Exports

```ts
import {
  // components (shadcn new-york, adapted — see "Adding a shadcn component")
   Button, buttonVariants, type ButtonProps,
   Input, type InputProps,
   Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter,
   AlertDialog, ConfirmDialog, Dialog, DropdownMenu, Popover, Tooltip, TooltipProvider,
   Tabs, Switch, Checkbox, RadioGroup, Select, Separator, Skeleton, Textarea,
   Label, Kbd, Spinner, Toaster, toast,
  // theming
  ThemeProvider, useTheme, type ThemeProviderProps, type ThemeContextValue,
  THEME_INIT_SCRIPT, createThemeInitScript,
  THEMES, RESOLVED_THEMES, THEME_STORAGE_KEY, isTheme, isResolvedTheme, resolveTheme,
  type Theme, type ResolvedTheme, type SystemPreferences,
  // utilities
  cn,
} from "@tj/ui";
```

CSS entry point: `@tj/ui/styles/globals.css` (the **only** place design tokens are defined).

Everything is consumed from source (`exports` → `./src/*.ts`), see the root README.

## Consuming the CSS in an app

Two lines in the app's single CSS entry file. The second one tells Tailwind to scan this
package's source so classes used *inside* `@tj/ui` components are generated (the `@source "../"`
inside `globals.css` also does this, relative to the imported file; the explicit line is
belt-and-braces and documents the dependency). Paths are **relative to the CSS file**:

```css
/* apps/web/src/styles.css */
@import "@tj/ui/styles/globals.css";
@source "../../../packages/ui/src";
```

```css
/* apps/web/styles.css (if the entry sits at the app root instead) */
@import "@tj/ui/styles/globals.css";
@source "../../packages/ui/src";
```

The app itself uses `@tailwindcss/vite` (or the PostCSS plugin); it needs no `tailwind.config.*`.
Tailwind auto-detects the app's own source files; only the package path must be spelled out.

Do **not** re-declare tokens or `@theme` blocks in apps — extend `globals.css` here instead.

## Theming

Three themes: `light`, `dark`, `high-contrast`. Selection is the `data-theme` attribute on
`<html>`; `globals.css` defines the variables for `:root` (light), `[data-theme="dark"]` and
`[data-theme="high-contrast"]` and maps them to Tailwind utilities in one `@theme inline` block
(`bg-background`, `text-muted-foreground`, `bg-status-taught`, `border-border`, `ring-ring`, …).

### Before JavaScript runs

- `html:not([data-theme])` + `@media (prefers-color-scheme: dark)` applies the dark palette so the
  OS preference is honoured on first paint even with no JS.
- To also honour a *stored* choice before React mounts (no flash), inline the init script as the
  first child of `<head>`, before the stylesheet:

  ```html
  <!-- apps/web/index.html -->
  <script>/* paste THEME_INIT_SCRIPT here, or inject it at build time */</script>
  ```

  `THEME_INIT_SCRIPT` is a dependency-free ES5 string (`createThemeInitScript(storageKey)` for a
  custom key). It never throws; if storage or `matchMedia` is unavailable the CSS fallback applies.

### In React

```tsx
import { ThemeProvider } from "@tj/ui";

<ThemeProvider>                       {/* defaultTheme="system", storageKey="tj-theme" */}
  <App />
</ThemeProvider>
```

```tsx
const { theme, resolvedTheme, setTheme } = useTheme();
// theme:         "light" | "dark" | "high-contrast" | "system"   (the user's choice)
// resolvedTheme: "light" | "dark" | "high-contrast"              (what is on <html>)
setTheme("high-contrast");           // persisted to localStorage["tj-theme"]
```

Resolution rules (identical in `resolveTheme()`, `ThemeProvider` and `THEME_INIT_SCRIPT`):

1. A stored explicit theme wins over the OS. Invalid stored values are ignored.
2. `system` → `prefers-contrast: more` ⇒ `high-contrast`; else `prefers-color-scheme: dark` ⇒
   `dark`; else `light`. The provider listens for OS changes while in `system` mode.
3. `high-contrast` is otherwise explicit only. It is currently a light-based black/white palette;
   F18 decides whether a dark high-contrast variant is needed (F18-D4).
4. `color-scheme` (native controls, scrollbars) is set by the CSS per theme, not by JS.
5. Changes in another tab are mirrored via the `storage` event.

`useTheme()` throws when used outside `<ThemeProvider>`.

### Conventions

- **Never use `dark:`** in components or apps. Colours come from tokens, which already change with
  the theme. (Tailwind's default `dark:` is an OS media query and would ignore the user's explicit
  choice; `globals.css` re-points the variant at `[data-theme="dark"]` purely as a safety net.)
- **Never hard-code colours** (`text-white`, `bg-zinc-100`, hex). Add a token if one is missing.

## Motion: `motion-safe:` convention

Every transition/animation utility is written with the `motion-safe:` prefix
(`motion-safe:transition-colors`, `motion-safe:animate-spin`, …) so users with
`prefers-reduced-motion: reduce` get no motion. Apply the same rule in apps, and rewrite
`transition-*` / `animate-*` classes in freshly added shadcn components.

## Adding a shadcn component

Run the CLI **inside this package** (apps never do this — ADR 0009):

```sh
cd packages/ui
bunx shadcn@latest add <name>          # e.g. dialog
```

`components.json` routes files to `src/components/<name>.tsx` and imports `cn` from `@/lib/cn`
(the `@/*` alias is package-local, ADR 0013). Then adapt the generated file:

1. Replace the `@/lib/cn` import with a relative one (`../lib/cn`) — relative imports need no
   alias configuration in consuming apps.
2. Map shadcn token names to ours (shadcn's *accent* is a hover tint, ours is the brand accent):

   | shadcn                                       | `@tj/ui`                                   |
   | -------------------------------------------- | ------------------------------------------ |
   | `bg-primary` / `text-primary-foreground`     | `bg-accent` / `text-accent-foreground`     |
   | `bg-secondary` / `text-secondary-foreground` | `bg-muted` / `text-muted-foreground`       |
   | `hover:bg-accent hover:text-accent-foreground` | `hover:bg-muted hover:text-foreground`   |
   | `bg-card` / `text-card-foreground`           | `bg-surface` / `text-surface-foreground`   |
   | `bg-popover` / `text-popover-foreground`     | `bg-surface` / `text-surface-foreground`   |
   | `border-input`                               | `border-border` (or plain `border`)        |
   | `text-white` on `bg-destructive`             | `text-destructive-foreground`              |
   | any `dark:*` class                            | delete                                     |

3. Prefix `transition-*` / `animate-*` with `motion-safe:`.
4. Default `type="button"` on native buttons (see `button.tsx` for the `asChild` handling).
5. If the component imports `radix-ui`, either add that dependency or import the specific
   `@radix-ui/react-<primitive>` package (Button uses `@radix-ui/react-slot`).
6. Run `bun run lint` (Biome a11y at `error` — fix, don't disable) and add a test.
7. Export it from `src/index.ts`. Keep the component count deliberate.

Registry source for reference: `https://ui.shadcn.com/r/styles/new-york-v4/<name>.json`.

Note: `bunx shadcn init` cannot run here (it refuses without a recognised app framework), so
`components.json` was written by hand; `add` works non-interactively.

## Testing

`bun test` + React Testing Library + happy-dom (ADR 0014, amended):

```sh
bun run --filter=@tj/ui test          # bun test
bun run --filter=@tj/ui test:watch
```

`bunfig.toml#[test].preload` lists, in order, `@tj/config/bun-test/dom` (registers happy-dom on
`globalThis`), `@tj/config/bun-test/setup` (jest-dom matchers on Bun's `expect`, `cleanup()` after
each test) and `./bun-test.setup.ts`, which mocks `window.matchMedia`
(`setMatchMedia({ dark, moreContrast })`, `emitMatchMediaChange()`) and resets `localStorage` and
`<html data-theme>` between tests. Bun resolves the `@/*` alias from `tsconfig.json#paths` natively.
The jest-dom matcher types come from `@tj/config/bun-test/jest-dom` (listed in `tsconfig.json`
`types`).

Radix overlay tests also rely on the package setup's minimal `ResizeObserver`, `PointerEvent`, and
`scrollIntoView` polyfills. Keep those polyfills rather than skipping portal interaction tests.

## Notes for maintainers

- **Biome CSS parsing.** `packages/ui/biome.json` (`root: false`, `extends: "//"`) exists only to
  set `css.parser.tailwindDirectives: true` so Biome can parse `@theme`, `@source`, `@apply`,
  `@custom-variant`. Follow-up: move that option to the root `biome.json` and delete the nested
  file (root README says packages carry no Biome config).
- **`packages/config/tailwind.preset.ts`** is unused: Tailwind v4 is CSS-first, tokens live in
  `globals.css` `@theme`. F18 should decide whether to delete it (recommended) or repurpose it.
- **Dependencies** are pinned exactly (`bunfig.toml` `exact = true`). React/ReactDOM are peers
  (`^19`) with exact devDependency copies for tests. Aligning versions across `apps/web`:
  `react 19.2.8`, `tailwindcss 4.3.3`, `@testing-library/react 16.3.3`.
- **Build.** There is no build step; apps compile the source. To smoke-test the CSS pipeline
  without an app: `bunx --package @tailwindcss/cli tailwindcss -i src/styles/globals.css -o /tmp/ui.css`
  and grep for `.bg-background`, `.motion-safe\:transition-all`, `[data-theme="dark"]`.
