import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WRITER_BUNDLE_ID, WRITER_BUNDLES, type WriterBundle, writerBundle } from "./bundle";
import { schemaText, type WriterStage } from "./schema";

/*
 * Pins (TEACH-110 part b, rows 1 and 2): every ported prompt file is the pinned bytes, and the
 * schema builder at Standard (9–12) gives the pinned schema byte for byte, so the writer's hash
 * (system text and schema, all three stages, the evidence registry's rule) is the pinned one.
 */

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const STAGES: WriterStage[] = ["KS1", "KS2", "KS3-5"];
/**
 * The lab's pins for each bundle, copied from the evidence's `ab/PINS.json` (its sha256 at copy
 * time is in the file): the test compares the shipped bytes with these, never with the generated
 * module's own record.
 */
const labPins = (id: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, `fixtures/pins/${id}.json`), "utf8")) as {
    sourceSha256: string;
    pins: Record<string, string>;
  };
/** Inputs the lab generated its pinned files from; it never pinned them, so they are not compared. */
const UNPINNED = new Set([
  "T/layouts.KS1.txt",
  "T/layouts.KS2.txt",
  "T/layouts.KS3-5.txt",
  "T/caps.KS1.json",
  "T/caps.KS2.json",
  "T/caps.KS3-5.json",
  "shared/diagram-kinds.json",
]);
const BUNDLES = Object.values(WRITER_BUNDLES) as WriterBundle[];

describe.each(BUNDLES.map((b) => [b.id, b] as const))("writer bundle %s", (_id, b) => {
  const lab = labPins(b.id);
  test("the pin fixture names its source", () =>
    expect(lab.sourceSha256).toMatch(/^[0-9a-f]{64}$/));
  test.each(Object.entries(b.pins))("%s is the lab's pinned bytes", (name, pin) => {
    const text = (b as unknown as Record<string, string>)[name] as string;
    expect(typeof text).toBe("string");
    const want = lab.pins[pin.file];
    if (want === undefined) {
      expect(UNPINNED.has(pin.file)).toBe(true);
      return;
    }
    expect(sha(text)).toBe(want);
  });

  test("the schema builder gives the lab's pinned schema files at 9–12 on every stage", () => {
    for (const st of STAGES)
      expect(sha(schemaText(st, { min: 9, max: 12 }, b))).toBe(
        lab.pins[`T/schema.${st}.json`] as string,
      );
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
