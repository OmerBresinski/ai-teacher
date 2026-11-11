/**
 * The `lesson.worksheet` job's three steps (ADR 0030 item 3; TDD §7): `buildFrame` (no model
 * call), `fillFrame` (one `small` call for the placeholder slots) and `checkWorksheet` (the
 * deterministic checks and one repair pass). The worker persists between them.
 */

// The new sheet path (worksheets plan v2, T6): built from the slides, gated, saved once.
export * from "./build";
export * from "./check";
export * from "./fill";
export * from "./frame";
export * from "./gate";
export * from "./sheet-items";
export * from "./specs";
export * from "./write-sheet";
