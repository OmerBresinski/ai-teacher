import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { WRITER_BUNDLE_ID, WRITER_BUNDLES, type WriterBundle, writerBundle } from "./bundle";
import { schemaText, type WriterStage } from "./schema";

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

const BUNDLES = Object.values(WRITER_BUNDLES) as WriterBundle[];

describe.each(BUNDLES.map((b) => [b.id, b] as const))("writer bundle %s", (_id, b) => {
  test.each(Object.entries(b.pins))("%s is its pinned bytes", (name, pin) => {
    const text = (b as unknown as Record<string, string>)[name] as string;
    expect(typeof text).toBe("string");
    expect(sha(text)).toBe(pin.sha256);
  });

  test("the writer hash (system text and schema, 3 stages, at 9–12) is the bundle's pinned one", () => {
    const system: Record<WriterStage, string> = {
      KS1: b.systemKS1,
      KS2: b.systemKS2,
      "KS3-5": b.systemKS3_5,
    };
    const files: [string, string][] = STAGES.flatMap((st): [string, string][] => [
      [`T/system.${st}.txt`, system[st]],
      [`T/schema.${st}.json`, schemaText(st, { min: 9, max: 12 }, b)],
    ]);
    const h = createHash("sha256");
    for (const [f, text] of files.sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
      h.update(f);
      h.update(text);
    }
    expect(h.digest("hex").slice(0, 12)).toBe(b.tHash);
  });

  test("nothing is appended to the system text", () => {
    for (const t of [b.systemKS1, b.systemKS2, b.systemKS3_5]) expect(t).not.toContain("{{");
  });
});

describe("the shipped bundle", () => {
  test("is base4, the evidence's pinned writer (T hash 18057b0c7aa8)", () => {
    expect(WRITER_BUNDLE_ID).toBe("base4");
    expect(writerBundle().tHash).toBe("18057b0c7aa8");
  });
  test("its schema builder gives the pinned schema files at 9–12 on every stage", () => {
    for (const st of STAGES)
      expect(sha(schemaText(st, { min: 9, max: 12 }, writerBundle("base4")))).toBe(SCHEMA_PINS[st]);
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
