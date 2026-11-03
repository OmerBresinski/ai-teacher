import { describe, expect, test } from "bun:test";
import { BASE_KIND, FALLBACK_KIND } from "./catalogue";
import { DRAWING_PARAMS, missingDrawingParams } from "./drawing-params";
import { checkParams, type LibFiller, libraryDiagram } from "./fill";
import { MODEL_LOADERS } from "./models";
import { kit, loadModel, renderLibraryModel } from "./render";

// biome-ignore lint/suspicious/noExplicitAny: the vendored models and their params are untyped JS
type J = any;

/*
 * TEACH-247 part de: Y9 equations slide 5 said 2x − 3 = 7, x = 5. The fill sent no input, so the
 * function machine drew its default 6 → 9 beside the caption. A value that reaches what pupils see
 * is refused when the fill leaves it out, and the fill's repair call sets it.
 */
const SAVED_FILL = {
  mode: "machine",
  machine: {
    steps: [
      { op: "×", n: 2 },
      { op: "−", n: 3 },
    ],
    findInput: true,
    backwards: true,
  },
};
const ASK = {
  key: "figure",
  model: "balance_equations",
  intent: "A function machine reverses 2x − 3 = 7 to find x = 5.",
  words: "Reverse the machine. Adding 3, then dividing by 2, gives x = 5.",
  yearGroup: "Year 9",
  lesson: "Equations",
};

describe("the saved fill", () => {
  test("is refused with a reason naming the input", async () => {
    const c = await checkParams("balance_equations", SAVED_FILL);
    expect(c.params).toBeUndefined();
    expect(c.refusals.map((r) => r.path)).toEqual(["machine.input"]);
    expect(c.refusals[0]?.reason).toContain("machine.input is missing");
  });

  test("the repair call hears why, and the drawing then shows the slide's numbers", async () => {
    const turns: string[] = [];
    const filler: LibFiller = async ({ user }) => {
      turns.push(user);
      return turns.length === 1
        ? SAVED_FILL
        : { ...SAVED_FILL, machine: { ...SAVED_FILL.machine, input: 5 } };
    };
    const r = await libraryDiagram(ASK, filler);
    if (!r.ok) throw new Error(r.reason);
    expect(r.attempts).toBe(2);
    expect(turns[1]).toContain("machine.input is missing");
    expect((r.params.machine as J).input).toBe(5);
    const words = [...r.drawing.svg.matchAll(/<text[\s\S]*?<\/text>/g)]
      .map((m) => m[0].replace(/<[^>]+>/g, " "))
      .join(" ");
    expect(words).toMatch(/\b7\b/);
    expect(words).not.toMatch(/\b9\b/);
  });

  test("a fill that never sets it keeps a visual: it falls back to the drawer", async () => {
    let calls = 0;
    const r = await libraryDiagram(ASK, async () => {
      calls++;
      return SAVED_FILL;
    });
    expect(calls).toBe(2);
    if (r.ok) throw new Error("drew with a default");
    expect(r.fallbackKind).toBe(BASE_KIND.balance_equations ?? FALLBACK_KIND);
    expect(r.reason).toContain("machine.input");
  });
});

describe("the class, on the balance too", () => {
  const paths = async (out: J) =>
    (await checkParams("balance_equations", out)).refusals.map((r) => r.path);
  test("no sides", async () => {
    expect(await paths({ mode: "balance" })).toEqual(["balance.left", "balance.right"]);
  });
  test("one side", async () => {
    expect(await paths({ balance: { left: "2 + ?" } })).toEqual(["balance.right"]);
  });
  test("a letter the sides use, unnamed, would print as a", async () => {
    expect(await paths({ unknown: "letter", balance: { left: "2x + 3", right: "11" } })).toEqual([
      "letter",
    ]);
  });
  test("a mirror on an axis needs no crossing point", async () => {
    const reflect = (line: string) =>
      checkParams("coordinate_grid", {
        mode: "reflect",
        shape: [
          { name: "A", x: 1, y: 1 },
          { name: "B", x: 3, y: 1 },
          { name: "C", x: 1, y: 3 },
        ],
        mirror: { line },
      });
    const paths = async (line: string) => (await reflect(line)).refusals.map((r) => r.path);
    expect(await paths("x-axis")).not.toContain("mirror.at");
    expect(await paths("y-axis")).not.toContain("mirror.at");
    expect((await reflect("vertical")).refusals.map((r) => r.path)).toEqual(["mirror.at"]);
  });
  test("a whole fill passes", async () => {
    expect(
      await paths({
        mode: "machine",
        machine: { input: 5, steps: [{ op: "×", n: 2 }], findInput: false, backwards: true },
      }),
    ).toEqual([]);
  });
});

/**
 * Values that print a default and stay out of DRAWING_PARAMS. Each can only say something neutral,
 * or nothing false: the audit (TEACH-247 part de) found the rest of each model's values invisible
 * or already refused by its validate().
 */
const NEUTRAL = "a neutral stand-in that claims nothing about this slide";
const SIZE = "sizes the grid only: the model's validate refuses anything set outside it";
const SWITCHED = "only drawn when the fill set its switch or a neighbour, which it then chose";
const NO_PRINT = "shapes the drawing and prints nothing: changing it changed no word in the audit";
const WHEN = "named for its own type, which no preset draws";
const DEMO =
  "a demonstration value slides rarely state (4 of 4 saved transport fills gave no hours): refused, the fill could only invent one or go to the drawer. The model prints it even unset, so the true fix is a model that prints nothing when unset";
const LEFT: Record<string, Record<string, string>> = {
  timeline: { "today.year": SWITCHED },
  plant_growth: { days: DEMO, hours: DEMO, plantName: DEMO },
  heart_circulation: { "pulse.rest": DEMO, "pulse.active": DEMO },
  collision_theory: { particles: DEMO, moreParticles: DEMO },
  light_shadows: {
    objectHeight: DEMO,
    sourcePosition: DEMO,
    screenDistance: DEMO,
    angle: DEMO,
  },
  circuits: { cells: DEMO },
  equal_groups: { remainder: "0 draws nothing" },
  // A recorded fill (d52 Alib y5 s7, "3/5 of 35") left it out: counters stand for any things.
  fractions: { whole: NEUTRAL, things: NEUTRAL },
  bar_model: {
    unknownPart: "which part is hidden, a choice, not a value the words state",
    percent: WHEN,
    times: WHEN,
  },
  number_line: { step: "1 is what a count with no stated step means" },
  area_perimeter: { offset: NO_PRINT },
  shape_3d_nets: { netSquares: SWITCHED },
  evolution_adaptation: {
    arrangement: NO_PRINT,
    populationSize: DEMO,
    startCount: DEMO,
    generations: DEMO,
  },
  forces_magnets: { varies: NO_PRINT },
  climate_biomes: {
    "customPlace.name": SWITCHED,
    "customPlace.lat": SWITCHED,
    "customPlace.lon": SWITCHED,
  },
  colour_mixing: { steps: NO_PRINT },
  earth_sun_moon: { place: NEUTRAL },
  coordinate_grid: {
    "grid.across": SIZE,
    "grid.up": SIZE,
    "mover.name": NEUTRAL,
    "mirror.at": "named for a vertical or horizontal mirror, which no preset draws",
  },
  volcano_earthquake: { "town.name": NEUTRAL, focusDepth: DEMO, "magnitude.value": DEMO },
  rivers_coasts: {
    "river.name": NEUTRAL,
    "river.source": NEUTRAL,
    "river.sea": NEUTRAL,
    "river.sourceHeight": NO_PRINT,
  },
  map_skills: {
    "grid.cols": SIZE,
    "grid.rows": SIZE,
    "grid.e0": SIZE,
    "grid.n0": SIZE,
    "scale.across": DEMO,
  },
  algorithm_grid: {
    robotName: NEUTRAL,
    "start.col": DEMO,
    "start.row": DEMO,
    "goal.col": DEMO,
    "goal.row": DEMO,
    cols: SIZE,
    rows: SIZE,
    repeat: "1 is no repeat",
    "bug.step": SWITCHED,
    "bug.count": SWITCHED,
  },
  cycle_wheel: { "today.day": SWITCHED, year: DEMO, centre: "the hub's label, true of any year" },
  classify_key: {
    questions: "rebuilt from the items' own facts when its answers name none of them",
  },
  rhythm_grid: { "pitch.notes": SWITCHED, beats: DEMO, bars: DEMO, tempoWord: DEMO },
  movement_court: {
    teamA: NEUTRAL,
    teamB: NEUTRAL,
    ball: "which player starts, a stage direction",
  },
};

/** A preset that shows the model's own default content: its slide is what the default says. */
const IS_THE_DEFAULT = new Set(["y4-minibeast-key"]);

describe("every shipped model", () => {
  const leafDefaults = (s: J, pre = ""): { path: string; s: J }[] =>
    Object.entries((s.properties ?? {}) as Record<string, J>).flatMap(([k, v]) => {
      const path = pre ? `${pre}.${k}` : k;
      if ((s.required ?? []).includes(k)) return []; // the schema check refuses it already
      return v.type === "object" && v.properties ? leafDefaults(v, path) : [{ path, s: v }];
    });

  test("a preset is a whole fill: none is refused for what it left out", async () => {
    await kit();
    const bad: string[] = [];
    for (const id of Object.keys(MODEL_LOADERS)) {
      const m = (await loadModel(id)) as J;
      const k = await kit();
      for (const p of m.presets ?? []) {
        const full = k.withDefaults(m.params, p.params);
        // `always` holds a schema's required list, older than the presets' own omissions.
        const always = DRAWING_PARAMS[id]?.always ?? [];
        for (const r of missingDrawingParams(id, p.params, full))
          if (!always.includes(r.path) && !IS_THE_DEFAULT.has(p.id))
            bad.push(`${id}/${p.id}: ${r.path}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("each value printing a specific default is refused when left out, or named above", async () => {
    const k = await kit();
    const open: string[] = [];
    for (const id of Object.keys(MODEL_LOADERS)) {
      const m = (await loadModel(id)) as J;
      const named = new Set(DRAWING_PARAMS[id]?.always ?? []);
      for (const p of m.presets ?? [])
        for (const n of DRAWING_PARAMS[id]?.when?.(k.withDefaults(m.params, p.params)) ?? [])
          named.add(n);
      const covers = (path: string) =>
        [...named].some((n) => path === n || path.startsWith(`${n}.`)) || LEFT[id]?.[path];
      for (const { path, s } of leafDefaults(m.params)) {
        const top = path.split(".")[0] as string;
        if (["title", "text"].includes(top) || m.params.properties[top]?.["x-fill"] === false)
          continue;
        if (s.enum || s.type === "boolean" || s.default === undefined) continue;
        if (s.default === 0 || s.default === "" || (Array.isArray(s.default) && !s.default.length))
          continue;
        if (!covers(path)) open.push(`${id}.${path}`);
      }
    }
    expect(open).toEqual([]);
  });

  /**
   * Review of part de: a value refused in one mode may draw nothing in another ({mirror: {line:
   * "x-axis"}} needs no `at`). Each preset is tried with every choice of each of its options; for a
   * fill the model accepts, every value refused as left out must change what is drawn there.
   */
  test("a refused value is one the drawing shows, in every mode a preset can switch to", async () => {
    const k = await kit();
    // A variant the model cannot draw is not a fill it accepts: undefined, and skipped.
    const words = async (id: string, p: J) => {
      const m = (await loadModel(id)) as J;
      const d = await renderLibraryModel(id, p).catch(() => undefined);
      if (!d) return undefined;
      try {
        m.builds?.(p);
      } catch {
        return undefined;
      }
      return `${[...d.svg.matchAll(/<text[\s\S]*?<\/text>/g)].map((t) => t[0].replace(/<[^>]+>/g, " ")).join("|")}${JSON.stringify(m.builds?.(p))}`;
    };
    const at = (o: J, path: string) => path.split(".").reduce<J>((v, x) => v?.[x], o);
    const set = (o: J, path: string, v: unknown) => {
      const c = structuredClone(o);
      const ks = path.split(".");
      let a = c;
      for (const x of ks.slice(0, -1)) a = a[x] ??= {};
      a[ks.at(-1) as string] = v;
      return c;
    };
    const enums = (s: J, pre = ""): { path: string; values: unknown[] }[] =>
      Object.entries((s.properties ?? {}) as Record<string, J>).flatMap(([key, v]) => {
        const path = pre ? `${pre}.${key}` : key;
        if (v.enum) return [{ path, values: v.enum as unknown[] }];
        return v.type === "object" && v.properties ? enums(v, path) : [];
      });
    const shown: string[] = [];
    for (const id of Object.keys(DRAWING_PARAMS)) {
      const m = (await loadModel(id)) as J;
      if (!m) continue;
      const always = DRAWING_PARAMS[id]?.always ?? [];
      for (const p of m.presets ?? []) {
        if (IS_THE_DEFAULT.has(p.id)) continue;
        for (const e of enums(m.params))
          for (const value of e.values) {
            const own = set(p.params, e.path, value);
            const full = k.withDefaults(m.params, own);
            if (!m.validate(full).ok) continue;
            for (const r of missingDrawingParams(id, own, full)) {
              if (always.includes(r.path)) continue;
              const v = at(full, r.path);
              // Another value the model accepts: one more, longer words, or a list one shorter or longer.
              const others: unknown[] =
                typeof v === "number"
                  ? [v + 1, v - 1]
                  : typeof v === "string"
                    ? [`${v}x`]
                    : Array.isArray(v)
                      ? [v.slice(1), v.slice(0, -1), [...v, ...v.slice(-1)], [...v].reverse()]
                      : [];
              const moved = others
                .map((o) => set(full, r.path, o))
                .find(
                  (o) => JSON.stringify(at(o, r.path)) !== JSON.stringify(v) && m.validate(o).ok,
                );
              if (!moved) continue;
              const before = await words(id, full);
              if (before !== undefined && before === (await words(id, moved)))
                shown.push(`${id}/${p.id} ${e.path}=${String(value)}: ${r.path}`);
            }
          }
      }
    }
    expect([...new Set(shown)]).toEqual([]);
  }, 300_000);
});
