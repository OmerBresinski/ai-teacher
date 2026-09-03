import { z } from "zod";

/**
 * Canonical wire format for timestamps: an ISO 8601 date-time in UTC with a `Z` suffix,
 * exactly what `new Date().toISOString()` produces (e.g. `2026-09-04T12:34:56.789Z`).
 *
 * Offsets (`+01:00`) are deliberately rejected so every stored/streamed timestamp compares
 * lexicographically. Convert at the edges (`Date#toISOString()` on the server, `new Date(s)` in
 * the browser).
 */
export const IsoDateTime = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTime>;
