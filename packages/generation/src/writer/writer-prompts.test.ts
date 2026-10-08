import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { schemaText, type WriterStage } from "./schema";
import * as P from "./writer-prompts.gen";

/*
 * Pins (TEACH-110 part b, rows 1 and 2): every ported prompt file is the pinned bytes, and the
 * schema builder at Standard (9–12) gives the pinned schema byte for byte, so the writer's hash
 * (system text and schema, all three stages, the evidence registry's rule) is the pinned one.
 */

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const STAGES: WriterStage[] = ["KS1", "KS2", "KS3-5"];
/** sha256 of the pinned `T/schema.<stage>.json` files. */
const SCHEMA_PINS: Record<WriterStage, string> = {
  KS1: "27d4461357460a33b30e38a689d4c6031fad34109726e1df3cb2954be73036d4",
  KS2: "ba83b39f6601c093637fa4e4bedd0ded582ed4280759a991f64331411f4bc035",
  "KS3-5": "f85239d5ad9cb42b956cfe7e1bf2362c770a5955cf6b30dc88f04d5ba23a0bce",
};

describe("writer prompt pins", () => {
  test.each(Object.entries(P.WRITER_PROMPT_SHA256))("%s is the pinned bytes", (name, pin) => {
    const text = (P as unknown as Record<string, string>)[name] as string;
    expect(sha(text)).toBe(pin.sha256);
  });

  test("the schema builder gives the pinned schema at 9–12 on every stage", () => {
    for (const st of STAGES) expect(sha(schemaText(st, { min: 9, max: 12 }))).toBe(SCHEMA_PINS[st]);
  });

  test("the writer hash (system text and schema, 3 stages) is the pinned 18057b0c7aa8", () => {
    const system: Record<WriterStage, string> = {
      KS1: P.systemKS1,
      KS2: P.systemKS2,
      "KS3-5": P.systemKS3_5,
    };
    const files: [string, string][] = STAGES.flatMap((st): [string, string][] => [
      [`T/system.${st}.txt`, system[st]],
      [`T/schema.${st}.json`, schemaText(st, { min: 9, max: 12 })],
    ]);
    const h = createHash("sha256");
    for (const [f, text] of files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      h.update(f);
      h.update(text);
    }
    expect(h.digest("hex").slice(0, 12)).toBe("18057b0c7aa8");
  });

  test("nothing is appended to the system text", () => {
    for (const t of [P.systemKS1, P.systemKS2, P.systemKS3_5]) expect(t).not.toContain("{{");
  });
});

describe("drawer fallback text (part d reads it)", () => {
  test("the diagram contract is the pinned writer's bytes", async () => {
    const { DIAGRAM_CONTRACT, DIAGRAM_CONTRACT_SHA256, writerDrawerSystem } = await import(
      "./diagram-contract.gen"
    );
    expect(sha(DIAGRAM_CONTRACT)).toBe(DIAGRAM_CONTRACT_SHA256);
    expect(writerDrawerSystem.endsWith(`\n\n${DIAGRAM_CONTRACT}`)).toBe(true);
  });
});
