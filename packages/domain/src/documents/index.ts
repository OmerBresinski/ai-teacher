/**
 * `@tj/domain/documents` — the tie-in document contract (ADR 0021): TeachDeck's Lesson,
 * Worksheet and Series shapes, their Zod schemas, `migrate()` and the parse helpers. Adopted
 * verbatim from `gregjwa/pres-ui-temp` `lib/model/{types,schema}.ts` at `f3dbcf7`, plus the two
 * optional TD item 5 fields on Lesson and, for F01 (ADR 0024 §1–3), `Lesson.brief`, the
 * `ClassContext` schema, the Identifier guard and `summarise()`.
 *
 * Not re-exported from the package root: `Lesson` here is the editor document, while
 * `objects/lesson.ts` `Lesson` is the future workspace-owned persistence row. Import this
 * subpath explicitly. Depends on `zod` only (ADR 0013).
 */

export * from "./brief";
export * from "./class-context";
export * from "./create-lesson";
export * from "./identifier-guard";
export * from "./lesson";
export * from "./links";
export * from "./migrate";
export * from "./rich-text";
export * from "./series";
export * from "./slide";
export * from "./summarise";
export * from "./theme";
export * from "./worksheet";
