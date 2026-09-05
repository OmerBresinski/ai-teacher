# 0009 — Tailwind + shadcn/ui as the design-system base

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: F18-R13 (design system), F18-R09 (WCAG 2.2 AA), F18-D4 (light/dark/high-contrast), F18 §7 (visual direction)

## Context

F18 requires tokens, a component library on accessible primitives, and that every feature builds from it. Alternatives (React Aria Components, Vanilla Extract) offer stronger a11y or type-safe styles but slow the start.

## Decision

`packages/ui` is the design system. It uses Tailwind CSS v4 with tokens expressed as CSS custom properties (colour, type, spacing, radius on an 8 px grid) and shadcn/ui components generated into the package (Radix primitives). Themes (light, dark, high-contrast) switch by a `data-theme` attribute on `<html>`. Apps consume `@tj/ui` and never install shadcn components directly.

## Consequences

- Amended 2026-09-05 by ADR 0019.
- Fast to reach a Linear-grade shell; accessibility of primitives is inherited from Radix.
- The scaffold installs Tailwind and the shadcn configuration only; tokens, state chips and the component set are F18 project work.
- shadcn components are copied source, so upgrades are manual; keep the component count deliberate.

## Amendment (2026-09-05, ADR 0019)

The Decision's "radius on an 8 px grid" clause is superseded by ADR 0019's named 6/8/10/12/16px
radius ladder. The Consequences clause that tokens, state chips, and the component set are F18
project work is superseded: `@tj/ui` adopts the TeachDeck tokens, F18-R07 chips are not built in
the shell, and the component boundary is the shell kit in `@tj/ui` and editor kit in `@tj/editor`.
