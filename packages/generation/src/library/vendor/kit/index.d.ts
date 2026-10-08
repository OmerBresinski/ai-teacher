// Types for the vendored library kit (lab/library at 8fbfb912): only what production calls.
import type { LibModel, LibParams, LibRefusal, LibStage } from "../../types";
export declare const GRID: { W: number; H: number; top: number; bottom: number; foot: number; left: number; right: number };
export declare function withDefaults(schema: LibParams, value: unknown): Record<string, unknown>;
export declare function schemaCheck(schema: unknown, value: unknown): LibRefusal[];
export declare function clone<T>(o: T): T;
export declare function mountSlide(
  host: unknown,
  model: LibModel,
  params: Record<string, unknown>,
  opts?: { theme?: string },
): LibStage;
