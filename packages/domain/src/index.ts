/**
 * `@tj/domain` — Zod schemas and TypeScript types shared by every app and package.
 *
 * Depends on `zod` only; never on another `@tj/*` package (ADR 0013). Subpath exports mirror the
 * files below (`@tj/domain/ids`, `@tj/domain/jobs`, ...). `@tj/domain/documents` (ADR 0021) is
 * subpath-only: its `Lesson` is the editor document, not the `objects/` row skeleton.
 */

export * from "./ai";
export * from "./ids";
export * from "./jobs";
export * from "./objects/index";
export * from "./primitives";
export * from "./result";
export * from "./states";
export * from "./storage";
