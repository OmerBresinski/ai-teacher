import { describe, expect, test } from "bun:test";
import { BASE_KIND, catalogue, libSchema, libSystem } from "../library/catalogue";
import { withActivities, withActivityMenu } from "./activities";
import { writerBundle } from "./bundle";
import { type Brief, promptStage } from "./fixes";
import {
  keepKind,
  lensOf,
  matchedExamples,
  promptOptionsTag,
  shapeSchema,
  shapeSystem,
  subjectFamily,
  topicOverlap,
  trimKindsBlock,
  trimModels,
  type WriterPromptOptions,
  yearToken,
  yearTokens,
} from "./prompt-options";
import { writerSchema } from "./schema";
import { writerSystem } from "./stage";

/*
 * WRITER-FIX-PLAN menu trimming and A/B arms: the options are off by default (the pinned text and
 * schema byte for byte); trimming keeps the rows a lesson can use, with the schema to match;
 * cacheOrder only moves blocks; examples none or matched.
 */
type J = Record<string, unknown>;
const brief = (topic: string, subject: string, yearGroup: string, keyStage: Brief["keyStage"]) =>
  ({ topic, subject, yearGroup, keyStage, slides: { min: 9, max: 12 } }) as Brief;
const LESSONS = {
  y1: brief("Animals and their young", "Science", "Year 1", "ks1"),
  y2: brief("Halves and quarters", "Maths", "Year 2", "ks1"),
  y5: brief("Fractions of amounts", "Maths", "Year 5", "ks2"),
  y8: brief("Weekend plans in the near future", "French", "Year 8", "ks3"),
  y11: brief("Rates of reaction", "Chemistry", "Year 11", "ks4"),
  y12: brief("The multi-store model of memory", "Psychology", "Year 12", "ks5"),
};
const B = "trimMenus" as const;
const ARMS: Record<string, WriterPromptOptions> = {
  off: {},
  B: { trimMenus: true, cacheOrder: true },
  C: { trimMenus: true, cacheOrder: true, examples: "none" },
  D: { trimMenus: true, cacheOrder: true, examples: "matched" },
};

/** The writer's system text and schema as the stage builds them (library and activities on). */
async function build(b: Brief, o: WriterPromptOptions) {
  const stage = promptStage(b.keyStage);
  const models = trimModels(await catalogue(stage), b, o);
  const schema = shapeSchema(
    withActivities(
      libSchema(
        writerSchema(stage, b.slides),
        models.map((m) => m.id),
      ),
      stage,
    ),
    b,
    o,
  );
  const system = shapeSystem(
    withActivityMenu(libSystem(writerSystem(b), models), stage),
    b,
    stage,
    o,
  );
  return { models, schema, system, stage };
}
const rows = (system: string, head: string) =>
  (system.split("\n\n").find((x) => x.startsWith(head)) ?? "")
    .split("\n")
    .flatMap((l) => /^- ([a-z][a-z-]*):/.exec(l)?.[1] ?? [])
    .filter((id) => id !== "model");

describe("year and subject", () => {
  test("year tokens", () => {
    expect(
      ["Reception", "Year 1", "Y1", "Year 6", "Year 8", "Year 11", "Year 12", "Year 13"].map(
        yearToken,
      ),
    ).toEqual(["Reception", "Y1", "Y1", "Y6", "KS3", "KS4", "KS5", "KS5"]);
    expect(yearToken("Mixed")).toBeUndefined();
    expect(yearToken("Year 14")).toBeUndefined();
  });
  test("subject families: word-bounded, one match or none", () => {
    expect(subjectFamily("Science")).toBe("science");
    expect(subjectFamily("GCSE Chemistry")).toBe("science");
    expect(subjectFamily("Maths")).toBe("maths");
    expect(subjectFamily("French")).toBe("cross");
    expect(subjectFamily("Art")).toBe("art");
    expect(subjectFamily("RE")).toBe("pshe");
    expect(subjectFamily("PE")).toBe("pe");
    // "art" is not in "particles", "RE" is not "rewrite", "pe" is not "people".
    expect(subjectFamily("particles")).toBeUndefined();
    expect(subjectFamily("rewrite")).toBeUndefined();
    expect(subjectFamily("people")).toBeUndefined();
    // Two families, or none, keep everything.
    expect(subjectFamily("Maths and science")).toBeUndefined();
    expect(subjectFamily("Topic")).toBeUndefined();
    expect(subjectFamily("")).toBeUndefined();
  });
});

describe("mixed year groups keep the union of their years", () => {
  test("ranges and lists", () => {
    expect(yearTokens("Year 1/2")).toEqual(["Y1", "Y2"]);
    expect(yearTokens("Reception/Year 1")).toEqual(["Reception", "Y1"]);
    expect(yearTokens("Years 5 and 6")).toEqual(["Y5", "Y6"]);
    expect(yearTokens("Years 3 to 6")).toEqual(["Y3", "Y4", "Y5", "Y6"]);
    expect(yearTokens("Y3-4")).toEqual(["Y3", "Y4"]);
    expect(yearTokens("Year 9/10")).toEqual(["KS3", "KS4"]);
    expect(yearTokens("Year 1")).toEqual(["Y1"]);
    expect(yearTokens("Mixed")).toEqual([]);
  });
  test("a mixed class keeps what either year can use", async () => {
    const one = await build(brief("Habitats", "Science", "Year 2", "ks1"), { [B]: true });
    const mixed = await build(brief("Habitats", "Science", "Reception/Year 2", "ks1"), {
      [B]: true,
    });
    // counting_subitising is Reception and Y1 only: not science, so neither keeps it; seasons_weather
    // (Reception-Y2) both keep; playground (R-Y2) both keep; treehouse (Y3-6) neither.
    expect(rows(mixed.system, "Themes:")).toEqual(rows(one.system, "Themes:"));
    const y56 = await build(brief("Habitats", "Science", "Years 5 and 6", "ks2"), { [B]: true });
    const y5 = await build(brief("Habitats", "Science", "Year 5", "ks2"), { [B]: true });
    const ids = (x: { models: { id: string }[] }) => x.models.map((m) => m.id);
    expect(ids(y56)).toEqual(expect.arrayContaining(ids(y5)));
    // heart_circulation is Y2 and Y6: a Years 5 and 6 class keeps it, a Year 5 class does not.
    expect(ids(y56)).toContain("heart_circulation");
    expect(ids(y5)).not.toContain("heart_circulation");
  });
});

describe("off by default", () => {
  test("system text and schema are byte for byte today's", async () => {
    for (const b of Object.values(LESSONS)) {
      const stage = promptStage(b.keyStage);
      const base = withActivityMenu(libSystem(writerSystem(b), await catalogue(stage)), stage);
      for (const o of [undefined, {}, { examples: "all" as const }]) {
        expect(shapeSystem(base, b, stage, o)).toBe(base);
        const schema = writerSchema(stage, b.slides);
        expect(shapeSchema(schema, b, o)).toBe(schema);
      }
    }
    expect(promptOptionsTag(undefined)).toBe("off");
    expect(promptOptionsTag(ARMS.D)).toBe("trim+cache+ex-matched");
  });
});

describe("trimMenus (the plan's table)", () => {
  const want: Record<keyof typeof LESSONS, [number, number, number]> = {
    // models, kinds, themes
    y1: [11, 13, 4],
    y2: [19, 15, 4],
    y5: [18, 15, 3],
    y8: [1, 11, 3],
    y11: [2, 13, 4],
    y12: [0, 11, 4],
  };
  for (const [k, b] of Object.entries(LESSONS))
    test(`${k}: models, kinds and themes, with the schema to match`, async () => {
      const { models, schema, system } = await build(b, { [B]: true });
      const kinds = rows(system, "Diagram kinds:");
      const themes = rows(system, "Themes:");
      expect([models.length, kinds.length, themes.length]).toEqual(want[k as keyof typeof LESSONS]);
      // The schema offers exactly the menu's themes and kinds.
      const text = JSON.stringify(schema);
      const defs = schema.$defs as Record<string, J>;
      const design = (schema.properties as J).design as J;
      expect(((design.properties as J).theme as J).enum).toEqual(themes);
      const schemaKinds = new Set(
        Object.keys(defs).flatMap((n) => /^dg-(.+)-(side|full)$/.exec(n)?.[1] ?? []),
      );
      for (const n of (((defs["diagram-freeform"] as J).properties as J).kind as J)
        .enum as string[])
        schemaKinds.add(n);
      schemaKinds.delete("model");
      expect([...schemaKinds].sort()).toEqual([...kinds].sort());
      // Every $ref resolves.
      for (const r of text.matchAll(/"\$ref":"#\/\$defs\/([^"]+)"/g))
        expect(defs[r[1] as string]).toBeDefined();
      // The model enum is the kept catalogue.
      const modelEnum = (
        (defs["dg-model-full"]?.properties as J | undefined)?.model as J | undefined
      )?.enum;
      expect(modelEnum ?? []).toEqual(models.map((m) => m.id));
      // A kept model's drawer fallback kind is offered too.
      for (const m of models)
        expect(keepKind(BASE_KIND[m.id] ?? "labelled-diagram", lensOf(b))).toBe(true);
      // The repair's kinds list is trimmed the same way.
      const repairKinds = trimKindsBlock(
        writerBundle().baseVisualsKS1.match(/Diagram kinds:[\s\S]*?(?=\n\s*\n|$)/)?.[0] ?? "",
        b,
        { [B]: true },
      );
      expect(rows(repairKinds, "Diagram kinds:").every((x) => kinds.includes(x))).toBe(true);
    });
  test("y1 drops the misfits the plan names", async () => {
    const { models, system } = await build(LESSONS.y1, { [B]: true });
    const ids = models.map((m) => m.id);
    for (const gone of ["food_chain", "hist_map", "angles_turns", "number_bonds", "fractions"])
      expect(ids).not.toContain(gone);
    expect(rows(system, "Diagram kinds:")).not.toContain("number-line");
    expect(rows(system, "Themes:")).not.toContain("studio");
  });
  test("an unknown subject or year keeps everything", async () => {
    const b = brief("Our local area", "Topic", "Mixed", "ks2");
    const all = await build(b, {});
    const trimmed = await build(b, { [B]: true });
    expect(trimmed.system).toBe(all.system);
    expect(trimmed.models.length).toBe(all.models.length);
  });
});

describe("cacheOrder", () => {
  test("only moves lines; rules first, examples last", async () => {
    for (const b of Object.values(LESSONS)) {
      const a = await build(b, { [B]: true });
      const c = await build(b, { [B]: true, cacheOrder: true });
      expect(c.system.split("\n").filter(Boolean).sort()).toEqual(
        a.system.split("\n").filter(Boolean).sort(),
      );
      expect(c.system.startsWith(writerSystem(b).split("\n\nThemes:")[0] as string)).toBe(true);
      expect(c.system.split("\n\n").at(-1)?.startsWith("Example slides")).toBe(true);
    }
  });
  test("the invariant part is shared by every lesson; the stage part by a stage's lessons", async () => {
    const sys = await Promise.all(
      Object.values(LESSONS).map(
        async (b) => (await build(b, ARMS.B as WriterPromptOptions)).system,
      ),
    );
    const common = (x: string, y: string) => {
      let n = 0;
      while (n < x.length && x[n] === y[n]) n++;
      return n;
    };
    const head = (s: string) => s.indexOf("\n\nLayouts.");
    const all = Math.min(...sys.map((s) => common(s, sys[0] as string)));
    expect(all).toBeGreaterThanOrEqual(head(sys[0] as string));
    // y1 and y2 (KS1) share up to their themes.
    const ks1 = common(sys[0] as string, sys[1] as string);
    expect(ks1).toBeGreaterThanOrEqual((sys[0] as string).indexOf("\n\nThemes:"));
  });
});

describe("examples", () => {
  const heads = [
    "A bean grows",
    "The Crystal Palace, 1851",
    "Which keeps you dry?",
    "Float or sink?",
    "Round 4,738 to the nearest hundred",
    "Acceleration from a graph",
    "Work out the speed",
  ];
  test("none removes the block", async () => {
    const { system } = await build(LESSONS.y1, { examples: "none" });
    expect(system).not.toContain("Example slides from other lessons");
    expect(system).not.toContain("Crystal Palace");
  });
  test("matched: same stage and family first, at least 2 led by a picture, at most 3", () => {
    const m = (b: Brief) => matchedExamples(heads, b, promptStage(b.keyStage));
    expect(m(LESSONS.y1)).toEqual(["A bean grows", "Which keeps you dry?", "Float or sink?"]);
    expect(m(LESSONS.y5)).toEqual([
      "A bean grows",
      "The Crystal Palace, 1851",
      "Round 4,738 to the nearest hundred",
    ]);
    expect(m(LESSONS.y11)).toEqual([
      "A bean grows",
      "The Crystal Palace, 1851",
      "Acceleration from a graph",
    ]);
    for (const b of Object.values(LESSONS)) {
      const got = m(b);
      expect(got.length).toBeGreaterThanOrEqual(2);
      expect(got.length).toBeLessThanOrEqual(3);
    }
  });
  test("no topic-word overlap: a plants lesson never sees the bean", () => {
    const b = brief("How plants grow from seeds", "Science", "Year 3", "ks2");
    expect(topicOverlap(b.topic, "A bean grows")).toBe(true);
    expect(matchedExamples(heads, b, "KS2")).not.toContain("A bean grows");
    const speed = brief("Speed, distance and time", "Physics", "Year 9", "ks3");
    expect(matchedExamples(heads, speed, "KS3-5")).not.toContain("Work out the speed");
  });
  test("matched keeps the block's head and the chosen lines as pinned", async () => {
    const { system } = await build(LESSONS.y1, { examples: "matched" });
    const block = system.split("\n\n").find((x) => x.startsWith("Example slides")) ?? "";
    expect(block.split("\n").filter(Boolean)).toHaveLength(4);
    expect(writerSystem(LESSONS.y1)).toContain(block.split("\n")[1] as string);
  });
});
