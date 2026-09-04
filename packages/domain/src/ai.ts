import { z } from "zod";

/** Model tiers selected by callers instead of provider-specific model IDs (ADR 0018). */
export const ModelClass = {
  frontier: "frontier",
  standard: "standard",
  small: "small",
} as const;

export const ModelClassSchema = z.enum(ModelClass);
export type ModelClass = z.infer<typeof ModelClassSchema>;
