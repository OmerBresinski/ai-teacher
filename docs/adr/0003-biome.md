# 0003 — Biome for lint and format

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: F18-R09 (WCAG 2.2 AA)

## Context

ESLint + Prettier offers the broadest plugin ecosystem (notably `jsx-a11y`). Biome is one fast binary for both linting and formatting, configured once at the root.

## Decision

Biome is the only linter and formatter. A single `biome.json` at the root; packages extend it only where needed. Biome's built-in a11y rule group is enabled at `error` level.

## Consequences

- Fast, zero-config-per-package linting; one pre-commit hook.
- Biome's a11y coverage is narrower than `eslint-plugin-jsx-a11y`. Accessibility is verified primarily by automated checks in Playwright (axe) and manual audits (F18 §8), not by lint alone. If Biome's a11y coverage proves insufficient during F18, add a minimal ESLint config running only `jsx-a11y` and record it as a new ADR.
