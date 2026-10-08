// lib arm $0 tests: catalogue, writer files, base4 byte-exact, fill/check/repair/fallback, the writer's ask.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { openaiSchemaFaults } from "../../../packages/slides/src/diagrams/wire";
import { getTheme } from "../../../packages/slides/src/themes";
import { armT } from "../arm-t";
import {
  AB,
  abFiles,
  abLib,
  menuKinds,
  pinFaults,
  SHARED_PINNED,
  STAGES,
  schemaKinds,
  setAbArm,
  sha,
} from "./arms";
import {
  BASE_KIND,
  catalogue,
  catalogueLines,
  checkParams,
  type Filler,
  fillAndCheck,
  libDiagram,
  libPlaceholders,
  libPrompt,
  library,
  libSchema,
  libSystem,
  STAGE_YEARS,
  UNAVAILABLE,
  writerWords,
} from "./lib";

type J = Record<string, unknown>;
const read = (f: string) => readFileSync(f, "utf8");
const req = (model: string) => ({
  model,
  intent: "twelve counters shared into two equal groups",
  words: "Find half of 12\nShare 12 counters into two equal groups.",
  yearGroup: "Year 2",
  lesson: "Maths: Halves and quarters",
});
/** A stub filler that answers from a queue (a preset's params, a patch, or junk). */
const queued = (outs: unknown[]) => {
  const seen: { user: string; attempt: number }[] = [];
  const f: Filler = async ({ user, attempt }) => {
    seen.push({ user, attempt });
    return { out: outs.shift(), usd: 0.001 };
  };
  return { f, seen };
};
const preset = async (id: string, n = 0) => (await library()).models.get(id)!.presets[n]!.params;

describe("catalogue", () => {
  test("baked-in models are never offered; every stage's entries meet its years", async () => {
    const { models } = await library();
    expect(models.size).toBe(52);
    for (const st of STAGES) {
      const c = await catalogue(st);
      expect(c.length).toBeGreaterThan(0);
      for (const id of Object.keys(UNAVAILABLE)) expect(c.map((e) => e.id)).not.toContain(id);
      for (const e of c) expect(e.years.some((y) => STAGE_YEARS[st].includes(y))).toBe(true);
    }
    const all = new Set((await Promise.all(STAGES.map(catalogue))).flat().map((e) => e.id));
    expect(all.size).toBe(50);
  });
  test("fallback kinds are base4 kinds", () => {
    const kinds = schemaKinds(JSON.parse(read(abFiles("base4", "KS2").schema)));
    for (const k of Object.values(BASE_KIND)) expect(kinds).toContain(k);
  });
});

describe("writer files", () => {
  test("lib = base4 + the model line, the catalogue and dg-model defs (generated, in sync)", async () => {
    for (const st of STAGES) {
      const base = abFiles("base4", st);
      const lib = abFiles("lib", st);
      const c = await catalogue(st);
      const sys = read(lib.system);
      expect(sys).toBe(libSystem(read(base.system), c));
      expect(JSON.parse(read(lib.schema))).toEqual(
        libSchema(
          JSON.parse(read(base.schema)),
          c.map((e) => e.id),
        ),
      );
      expect(read(lib.repairSchema)).toBe(read(base.repairSchema));
      // Only insertions: removing the added block gives base4 back.
      const b = read(base.system);
      expect(sys.length).toBeGreaterThan(b.length);
      expect(menuKinds(sys)).toEqual([...menuKinds(b), "model"]);
      for (const l of catalogueLines(c)) expect(sys).toContain(`\n${l}\n`);
      const schema = JSON.parse(read(lib.schema));
      expect(schemaKinds(schema)).toContain("model");
      expect(openaiSchemaFaults(schema, true)).toEqual([]);
      expect((schema.$defs["dg-model-side"] as J & { properties: J }).properties.model).toEqual({
        type: "string",
        enum: c.map((e) => e.id),
        description: writerWords().fields?.model,
      });
    }
  });
  test("base4 is byte-exact to its pins", () => {
    const pins = JSON.parse(read(`${AB}/PINS.json`)) as Record<string, string>;
    for (const st of STAGES)
      for (const f of Object.values(abFiles("base4", st)))
        expect(sha(read(f))).toBe(pins[f.slice(AB.length + 1)]!);
    for (const f of SHARED_PINNED) {
      const k = `prompts/base4/${f}`;
      if (pins[k]) expect(sha(read(`${AB}/${k}`))).toBe(pins[k]!);
    }
    expect(pinFaults("base4")).toEqual([]);
  });
  test("no lib prompt is a placeholder", () => {
    expect(libPlaceholders()).toEqual([]);
    expect(pinFaults("lib").some((f) => f.includes("placeholder"))).toBe(false);
  });
});

describe("fill, check, repair", () => {
  test("a preset passes first time", async () => {
    const { f, seen } = queued([await preset("equal_groups")]);
    const r = await fillAndCheck(req("equal_groups"), f);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(seen[0]!.user).toContain("Halves and quarters");
  });
  test("a refusal gets one repair carrying the reasons", async () => {
    const good = { ...(await preset("equal_groups")), groups: 2, size: 6, division: "sharing" };
    const { f, seen } = queued([{ ...good, groups: 99 }, good]);
    const r = await fillAndCheck(req("equal_groups"), f);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    const first = await checkParams("equal_groups", { ...good, groups: 99 });
    expect(first.refusals.length).toBeGreaterThan(0);
    expect(seen[1]!.user).toContain(first.refusals[0]!.reason);
    expect(seen[1]!.user).toContain('"groups":99');
  });
  test("validate() refusals count, not only schema faults", async () => {
    // A quarter of 13 counters cannot be shared without cutting them (fractions' validate refuses).
    const bad = { ...(await preset("fractions", 1)), amount: 13 };
    const c = await checkParams("fractions", bad);
    expect(c.params).toBeUndefined();
    expect(c.refusals[0]!.path).toBe("amount");
  });
  test("refused twice -> base4 kind fallback, or no figure; logged", async () => {
    const events: J[] = [];
    const deps = (outs: unknown[]) => ({
      filler: queued(outs).f,
      render: async () => {
        throw new Error("not reached");
      },
    });
    const ask = (model: string) => ({
      key: "3:figure",
      shows: "x",
      words: "w",
      yearGroup: "Year 2",
      spec: { model, intent: "i", alt: "a" },
      lib: { lesson: "l" },
    });
    const a = await libDiagram(ask("equal_groups"), deps([{ groups: "x" }, null]), (e) =>
      events.push(e as J),
    );
    expect(a).toEqual({ fallbackKind: "equal-groups", usd: 0.002 });
    const b = await libDiagram(ask("food_chain"), deps([null, null]), (e) => events.push(e as J));
    expect(b.fallbackKind).toBeUndefined();
    expect(b.libDrawn).toBeUndefined();
    expect(events.filter((e) => e.ev === "lib-fallback").map((e) => e.to)).toEqual([
      "equal-groups",
      "no figure",
    ]);
  });
  test("unavailable and unknown models make no call", async () => {
    for (const id of ["rivers_coasts", "place_change", "no_such_model"]) {
      const { f, seen } = queued([]);
      const r = await fillAndCheck(req(id), f);
      expect(r.ok).toBe(false);
      expect(seen.length).toBe(0);
    }
  });
  test("a drawn model becomes a drawn figure with the writer's alt", async () => {
    const r = await libDiagram(
      {
        key: "3:figure",
        shows: "x",
        words: "w",
        yearGroup: "Year 2",
        spec: { model: "equal_groups", intent: "i", alt: "Two rings of six." },
      },
      {
        filler: queued([await preset("equal_groups")]).f,
        render: async () => ({ src: "data:image/png;base64,x", aspect: 1.6, warnings: [] }),
      },
      () => {},
    );
    expect(r.libDrawn).toEqual({
      src: "data:image/png;base64,x",
      aspect: 1.6,
      alt: "Two rings of six.",
      model: "equal_groups",
    });
  });
  test("fill prompts are the prompt-engineer's", () => {
    expect(libPrompt("lib-fill.txt")).not.toContain("[PLACEHOLDER");
    expect(libPrompt("lib-fill-user.txt")).toContain("{{words}}");
    expect(libPrompt("lib-repair-user.txt")).toContain("{{refusals}}");
  });
});

describe("the writer's model figure", () => {
  const slide = {
    template: "visual-text",
    heading: "Find half of 12",
    lead: "Share 12 counters into two equal groups.",
    points: ["Each group has 6 counters."],
    figure: {
      kind: "model",
      model: "equal_groups",
      intent: "12 shared into 2 groups",
      alt: "Two rings of six.",
    },
  };
  test("lib: a diagram ask of kind model carrying the id and intent", () => {
    setAbArm("lib");
    expect(abLib()).toBe(true);
    const asks = armT.visuals!(slide, 3, {
      theme: getTheme("studio", "ks1"),
      stage: "ks1",
    } as never);
    setAbArm(undefined);
    expect(asks).toEqual([
      {
        key: "diagram",
        type: "diagram",
        kind: "model",
        shows: "12 shared into 2 groups",
        labels: [],
        spec: {
          model: "equal_groups",
          intent: "12 shared into 2 groups",
          alt: "Two rings of six.",
        },
      },
    ]);
  });
  test("base4: unchanged (no lib path)", () => {
    setAbArm("base4");
    expect(abLib()).toBe(false);
    const asks = armT.visuals!(slide, 3, {
      theme: getTheme("studio", "ks1"),
      stage: "ks1",
    } as never) as J[];
    setAbArm(undefined);
    expect(asks[0]!.spec).toBeUndefined();
  });
});
