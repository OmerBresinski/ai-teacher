// Filled by F18 (App Shell & Command Surface).
//
// Tailwind v4 is CSS-first (ADR 0009): tokens live in `@theme` blocks inside
// `packages/ui`. This file is the single JS-side entry point shared by every app
// and package that needs a Tailwind config object (content globs, plugins, ...).
// It is intentionally empty until F18 defines the design tokens.

export interface TailwindPreset {
  readonly theme: Record<string, never>;
}

const preset: TailwindPreset = {
  theme: {},
};

export default preset;
