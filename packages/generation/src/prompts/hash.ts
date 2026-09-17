import { PROMPTS, type PromptName } from "./index";

/*
 * Test-only, and kept out of `./index` on purpose: `Bun.CryptoHasher` is a Bun global, and the
 * prompt registry is on `apps/api`'s import path since TEACH-16 (`POST /briefs/parse`), whose
 * `AppType` is type-checked by browser consumers (`@tj/api-client`, `apps/web`) with no Bun types.
 */

/**
 * SHA-256 of a prompt's text: `system` plus `user(sampleInput)`. The test snapshots this per
 * version so a wording change without a version bump fails CI (ADR 0025 §17).
 */
export function promptHash(name: PromptName, sampleInput: unknown): string {
  const prompt = PROMPTS[name] as { system: string; user: (input: never) => string };
  const text = `${prompt.system}\n---\n${prompt.user(sampleInput as never)}`;
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}
