# 0019 — Adopt the TeachDeck visual system in `@tj/ui`; shell and editor kits

- Status: Accepted
- Date: 2026-09-05
- Related PRD decisions: TD project (Greg's row 1 decision), F18-D4, F18-R09, F18-R13

## Context

TeachDeck is the product's editor, present, export frontend, and design system. Greg's decision is
that its design system is the product's, while `@tj/ui` hosts the shell around the editor. The
shell and library screens are being ported first; the editor follows as a separate React library,
working name `@tj/editor`.

This creates two kits. `@tj/ui` already uses Tailwind v4, shadcn/ui, and Radix for the app shell.
TeachDeck's editor kit, `components/ui2`, is hand-rolled and owns its floating layer, Escape stack,
and portal host. The placeholder `@tj/ui` palette does not yet represent the TeachDeck visual
system.

## Decision

1. **Tokens.** `@tj/ui` adopts the TeachDeck palette, ink ladder, terracotta accent, lines, radius
   ladder, type ladder, and motion as its own tokens, replacing the placeholder palette. Tokens use
   shadcn semantic names so CLI-installed components need no colour edits: `--primary` is
   terracotta, `--accent` is the quiet hover wash, `--card` and `--popover` are elevated surfaces,
   `--secondary` and `--muted` are sunken surfaces, and `--destructive`, `--border`, `--input`,
   `--ring`, and sidebar tokens follow the TeachDeck mapping. `--surface` is retired in favour of
   `--card`. The radius ladder is named rather than represented by one `--radius`:
   `--radius-chip: 6px`, `--radius-control: 8px`, `--radius-card: 10px`,
   `--radius-dialog: 12px`, and `--radius-face: 16px`.
   The light palette is `--app-bg: #F7F6F2`, `--app-canvas: #EFECE6`,
   `--app-elevated: #FFFFFF`, `--app-sunken: #F9F8F6`, `--line: #E5E0D8`, and
   `--line-faint: #F2EFEB`; its control boundary is `#8A857B`. The ink ladder is `#1A1816`,
   `#4E4A44`, `#6B6761`, and decorative `#8F8A80`. Terracotta is `#D2644B`, with
   `#C05740` hover, `#AE4B31` press, and `#B04A33` small-accent text. Danger, success, and warning
   are `#B3261E`, `#217A54`, and `#8A5A00`. The type ladder is 12/16, 13/18, 14/20, 15/22, and
   20/26; spacing remains Tailwind's 4px scale; control heights are 24/32/36px and the app bar is
   48px. Pointer feedback is 150ms with no press scale (a 1px translate is allowed); one arrival
   motion uses a 16px rise/fade over 450ms with `cubic-bezier(0.22, 1, 0.36, 1)`, menus use 6px,
   and reduced motion collapses translation to a fade.
2. **Fonts.** Plus Jakarta Sans and Lora are self-hosted through
   `@fontsource-variable/plus-jakarta-sans` and `@fontsource/lora` (500), imported from
   `globals.css`. They are exposed as `--font-ui` and `--font-display`, with `font-ui` and
   `font-display` utilities. There are no Google Fonts requests and the CSP remains unchanged.
   Lora is used only at 20px or larger where the product says its own name; this is a review rule,
   not a code constraint.
3. **Themes.** TeachDeck light and dark become the application's `light` and `dark` themes.
   `high-contrast` remains, as required by F18-D4, derived from the dark tokens with
   contrast-raised values. Theme switching remains `data-theme` on `<html>` through the existing
   `ThemeProvider`; TeachDeck's `data-skin="v2"` scoping is not adopted for the shell. The
   permanently-dark present-mode stage palette belongs to `@tj/editor`.
4. **Contrast.** Filled primary controls meet 4.5:1. TeachDeck's 3.71:1 white-on-terracotta
   exception is not adopted. The implementation ticket chooses either ink-on-terracotta text or a
   darkened terracotta fill for filled buttons; the brand hue remains available for borders, icons,
   focus rings, and large text. axe rules are not exempted.
5. **Two kits.** Shell and library components in `@tj/ui` are shadcn/Radix components installed by
   the CLI in `packages/ui` and restyled to these tokens. This includes Sidebar, Dialog,
   AlertDialog, DropdownMenu, Popover, Tooltip, Tabs, Switch, Checkbox, RadioGroup, Slider, Toast
   (sonner), Skeleton, and related components. TeachDeck's hand-rolled `components/ui2` kit is not
   ported into `@tj/ui`; it ships inside `@tj/editor` and paints from the same CSS variables.
   `@tj/ui` owns the variables and `@tj/editor` reads them.
6. **States.** F18-R07 universal state chips (Draft, Reviewed, Stale, Taught, Needs attention) are
   not built in the shell: review states and provenance labels are superseded by the TD project
   decision, and the stale flag belongs to F07. The placeholder `--status-*` tokens are removed
   with the placeholder palette. TeachDeck's StatusPill states are ported as they are.

## Consequences

- shadcn output works without colour edits; its semantic tokens match the TeachDeck visual system.
- Two CSS-variable consumers must stay in sync: a token change belongs in `@tj/ui`, and the editor
  picks it up from there.
- `@tj/ui` continues to keep its component count deliberate.
- ADR 0009 is amended by this decision. `packages/ui/AGENTS.md` and `apps/web/AGENTS.md` mentions
  of state chips and placeholder tokens are stale and need a follow-up; they are not changed here.
