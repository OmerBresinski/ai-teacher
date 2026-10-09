import { describe, expect, test } from "bun:test";
import { catalogue, libSchema, libSystem } from "../library/catalogue";
import { withActivities, withActivityMenu } from "./activities";
import { type Brief, promptStage } from "./fixes";
import {
  CLARITY_EDITS,
  fullFitsLine,
  HIGHER_TIER,
  HINGE_EDITS,
  lines,
  MODEL_EDITS,
  RECALL_EDITS,
} from "./prompt-edits";
import {
  promptOptionsTag,
  shapeSchema,
  shapeSystem,
  type WriterPromptOptions,
} from "./prompt-options";
import { writerSchema } from "./schema";
import { writerSystem } from "./stage";

/*
 * #431 wording options (CROSSCHECK T1 clarity, T4 recallAfterObjectives, T5 answerVisibility):
 * each, alone, changes only its listed lines of the compiled system text against options off, at
 * every stage, with and without the library and activities; the schema never changes.
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
const COUNTED =
  /^- (hinge|question-set|practice|exit-ticket|steps|equation-hero|explain|visual-text|picture-sequence|compare): .* Fits: /;

async function build(b: Brief, o: WriterPromptOptions, full: boolean) {
  const stage = promptStage(b.keyStage);
  const models = full ? await catalogue(stage) : [];
  const libbed = libSchema(
    writerSchema(stage, b.slides),
    models.map((m) => m.id),
  );
  const schema = shapeSchema(full ? withActivities(libbed, stage) : libbed, b, o);
  const base = libSystem(writerSystem(b), models);
  const system = shapeSystem(full ? withActivityMenu(base, stage) : base, b, stage, o, schema);
  return { schema, system, stage };
}

/** The changed lines: [off, on] pairs (no line is added or removed). */
function changed(off: string, on: string): [string, string][] {
  const a = off.split("\n");
  const b = on.split("\n");
  expect(b.length).toBe(a.length);
  return a.flatMap((l, i): [string, string][] => (l === b[i] ? [] : [[l, b[i] as string]]));
}
const replaced = (line: string, edits: { from: string; to: string }[]) =>
  edits.reduce((l, e) => l.replace(e.from, e.to), line);
const rows = (line: string) => (line.split(" Fits: ")[1] ?? "").replace(/\.$/, "").split("; ");

for (const full of [false, true])
  describe(`wording options alone change only their lines${full ? " (library and activities on)" : ""}`, () => {
    for (const [k, b] of Object.entries(LESSONS)) {
      test(`${k}: clarity`, async () => {
        const off = await build(b, {}, full);
        const on = await build(b, { clarity: true }, full);
        expect(on.schema).toEqual(off.schema);
        const diff = changed(off.system, on.system);
        let fits = 0;
        for (const [was, now] of diff) {
          if (was.startsWith("- hinge: ")) {
            // Re-measured: every count row generated, the line before Fits unchanged.
            fits++;
            expect(now.split(" Fits: ")[0]).toBe(was.split(" Fits: ")[0] as string);
            expect(rows(now).map((r) => r.split(",")[0])).toEqual([
              "2 options",
              "3 options",
              "4 options",
            ]);
            continue;
          }
          if (COUNTED.test(was)) {
            // Only rows added: every pinned row stays, word for word and in order.
            fits++;
            expect(now.split(" Fits: ")[0]).toBe(was.split(" Fits: ")[0] as string);
            const kept = rows(now).filter((r) => rows(was).includes(r));
            expect(kept).toEqual(rows(was));
            expect(rows(now).length).toBeGreaterThan(rows(was).length);
            continue;
          }
          const higher = b.keyStage === "ks4" ? [] : [{ from: HIGHER_TIER, to: "" }];
          expect(now).toBe(replaced(was, [...CLARITY_EDITS, ...higher]));
        }
        // Five wording lines (the Higher-tier sentence shares the demand paragraph), plus Fits.
        expect(diff.length - fits).toBe(b.keyStage === "ks4" ? 5 : 6);
        expect(fits).toBeGreaterThanOrEqual(6);
        expect(on.system.includes(HIGHER_TIER)).toBe(b.keyStage === "ks4");
        expect(off.system.includes(HIGHER_TIER)).toBe(true);
      });

      test(`${k}: recallAfterObjectives`, async () => {
        const off = await build(b, {}, full);
        const on = await build(b, { recallAfterObjectives: true }, full);
        expect(on.schema).toEqual(off.schema);
        const diff = changed(off.system, on.system);
        expect(diff.length).toBe(1);
        for (const [was, now] of diff) expect(now).toBe(replaced(was, RECALL_EDITS));
      });

      test(`${k}: answerVisibility`, async () => {
        const off = await build(b, {}, full);
        const on = await build(b, { answerVisibility: true }, full);
        expect(on.schema).toEqual(off.schema);
        const diff = changed(off.system, on.system);
        const lib = off.system.includes("\n- model: ");
        const bar = off.system.includes("\n- bar_model, ");
        expect(diff.length).toBe(1 + (lib ? 1 : 0) + (bar ? 1 : 0));
        for (const [was, now] of diff)
          expect(now).toBe(replaced(was, [...HINGE_EDITS, ...MODEL_EDITS]));
        expect(on.system).not.toContain("what stays hidden on a question slide");
      });
    }
  });

describe("clarity: a Fits row for every count the schema allows", () => {
  for (const [k, b] of Object.entries(LESSONS))
    test(k, async () => {
      const { schema, system } = await build(b, { clarity: true }, true);
      const defs = schema.$defs as Record<string, { properties: Record<string, J> }>;
      const FIELD: Record<string, string> = {
        hinge: "options",
        "question-set": "questions",
        practice: "questions",
        "exit-ticket": "questions",
        steps: "points",
        "equation-hero": "points",
        explain: "points",
        "visual-text": "points",
      };
      for (const [layout, field] of Object.entries(FIELD)) {
        const p = defs[layout]?.properties[field] as { minItems: number; maxItems: number };
        const line = system.split("\n").find((l) => l.startsWith(`- ${layout}: `)) as string;
        const rs = rows(line).map((r) => r.split(/, | of up to /)[0] as string);
        const plain = rs.filter((r) => !/with|key card/.test(r));
        const pic = rs.filter((r) => / with (?:a )?picture/.test(r));
        for (let n = Math.max(p.minItems, 1); n <= p.maxItems; n++) {
          const has = (xs: string[]) => xs.some((r) => new RegExp(`(^|\\+ )${n} `).test(r));
          expect({ layout, n, plain: has(plain) }).toEqual({ layout, n, plain: true });
          if (pic.length) expect({ layout, n, pic: has(pic) }).toEqual({ layout, n, pic: true });
        }
      }
    });
});

describe("tags and line wording", () => {
  test("the hinge's rows are today's template's (KS3-5: 2 and 3 options in a row)", () => {
    const line = "- hinge: x. Fits: 3 options, half a line each; 4 options, 1 line each.";
    const schema = { $defs: { hinge: { properties: { options: { minItems: 2, maxItems: 4 } } } } };
    expect(fullFitsLine(line, "KS3-5", schema)).toBe(
      "- hinge: x. Fits: 2 options, 3 lines each; 3 options, 1 line each; 4 options, 1 line each.",
    );
  });
  test("the run record names each option", () => {
    expect(promptOptionsTag({ clarity: true })).toBe("clarity");
    expect(promptOptionsTag({ recallAfterObjectives: true })).toBe("recall");
    expect(promptOptionsTag({ answerVisibility: true })).toBe("answers");
  });
  test("lines() reads characters as make_menu.py does", () => {
    expect(lines(20, 54)).toBe("half a line");
    expect(lines(40, 28)).toBe("1 line");
    expect(lines(94, 28)).toBe("3 lines");
    expect(lines(240, 28)).toBe("8 lines");
  });
});
