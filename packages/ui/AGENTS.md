# AGENTS.md — `packages/ui` (`@tj/ui`)

The design system: Tailwind CSS v4 tokens + shadcn/ui components (Radix primitives), consumed by
`apps/web` as `@tj/ui`. Read the root [`AGENTS.md`](../../AGENTS.md) first. Scaffolded by
TEACH-13; tokens and the component set are F18 project work.

## Skills to load (in `./.agents/skills/`)

| Skill | Load when… |
| ----- | ---------- |
| `shadcn` | `components.json`, adding/updating components, registries, composing UI, Tailwind v4 styling |

## Constraints that override the skills

- **ADR 0009 — Tailwind v4 + shadcn live here and only here.** This package owns
  `components.json`, the Tailwind v4 setup and every shadcn component (`bunx --bun shadcn@latest
  add …` runs in this directory). Apps import from `@tj/ui`; they never install shadcn components
  or Tailwind plugins themselves. Components are copied source: keep the count deliberate and
  upgrade manually.
- **Theming via `data-theme`.** Tokens are CSS custom properties (colour, type, spacing, radius on
  an 8 px grid); light / dark / high-contrast themes switch with a `data-theme` attribute on
  `<html>` (F18-D4). Do not use Tailwind's `dark:` class strategy or a `.dark` root class.
- **Accessibility is enforced (F18-R09, WCAG 2.2 AA).** Biome's `a11y` rule group is at `error`;
  keep Radix primitives' semantics intact, never strip focus styles, and every interactive element
  is keyboard-reachable.
- Package shape follows the README ("Internal packages are consumed from source"): `exports` point
  at `src/*.ts(x)`, `tsconfig.json` extends `@tj/config/tsconfig/react.json`, tests run with
  Vitest + React Testing Library + jsdom (ADR 0014). `@tj/ui` depends on nothing internal except
  `@tj/config`.
