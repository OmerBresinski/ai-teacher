import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { directedImagePrompt, encodePng, type ImageGenerator } from "@tj/images";
import { BudgetExceeded } from "../types";
import {
  gridImagePrompt,
  isHistoricalSet,
  isSameSubjectSet,
  makePictureSet,
  type PictureSetDeps,
  type SetAsk,
  STRIP_ATTEMPTS,
  setImagePrompt,
  setIsGenerated,
  setMode,
  setSize,
  soloImagePrompt,
  TILE_GRID_OPENER,
} from "./picture-set";

describe("same-subject sets", () => {
  test("a sequence is always a set; compare cards only of one thing", () => {
    expect(
      isSameSubjectSet(["A newly hatched chick", "A growing young chicken", "An adult hen"], true),
    ).toBe(true);
    expect(
      isSameSubjectSet(["A young puppy standing side-on", "An older puppy of the same breed"]),
    ).toBe(true);
    expect(
      isSameSubjectSet(["A clear solution in a conical flask", "The flask with a cloudy mixture"]),
    ).toBe(true);
    expect(
      isSameSubjectSet(["An adult sheep beside a young lamb", "An adult cow beside a young calf"]),
    ).toBe(false);
    expect(isSameSubjectSet(["A frog", "A butterfly"])).toBe(false);
    expect(isSameSubjectSet(["A frog"], true)).toBe(false);
  });
  test("one strip prompt carries every panel in order and the same-subject frame", () => {
    const p = setImagePrompt(["A puppy.", "A young dog", "An adult dog"]);
    expect(p).toContain("3 equal side-by-side panels");
    expect(p).toContain("(1) A puppy; (2) A young dog; (3) An adult dog.");
    expect(p).toContain("very same individual subject");
    expect(setSize(3)).toBe("2048x1152");
    // Two panels take the wide size (0.87 panels, inside the slot ranges; base4 used 1536x1024).
    expect(setSize(2)).toBe("2048x1152");
  });
  test("an illustration lesson's locked look leads the strip", () => {
    const p = setImagePrompt(["A chick", "A hen"], { style: "illustration", palette: ["#111111"] });
    expect(p.split("\n")[0]).toContain("illustration");
    expect(p).toContain("#111111");
  });
});

describe("sets are about any subject, never real time", () => {
  test("non-animal sets group by their shared subject", () => {
    expect(
      isSameSubjectSet([
        "An ice cube on a plate",
        "A melting ice cube",
        "A small puddle where the ice cube was",
      ]),
    ).toBe(true);
    expect(
      isSameSubjectSet(["A shiny new iron nail", "The nail starting to rust", "A rusty iron nail"]),
    ).toBe(true);
    expect(
      isSameSubjectSet(["A tall candle", "The candle half burnt", "A short candle stub"]),
    ).toBe(true);
    expect(isSameSubjectSet(["A bean seed in soil", "A bean seedling", "A tall bean plant"])).toBe(
      true,
    );
  });
  test("change across real time is not a generated set (ruling 163)", () => {
    expect(isHistoricalSet(["The high street in 1900", "The same street in 2000"])).toBe(true);
    expect(isHistoricalSet(["A village a century ago", "The village today"])).toBe(true);
    expect(isHistoricalSet(["An ice cube", "A melting ice cube"])).toBe(false);
  });
  test("the frame names no animal words", () => {
    expect(setImagePrompt(["A", "B"])).not.toMatch(/breed|animal|fur|feather/i);
  });
});

describe("a solo panel is one picture, not a 1-panel strip (round 5)", () => {
  test("no gutter or panel layout wording for one panel", () => {
    const p = setImagePrompt(["A hen beside a chick"]);
    expect(p).not.toMatch(/side-by-side|gaps|Left to right/);
    expect(p).toContain("not divided into panels");
    expect(setSize(1)).toBe("1024x1024");
  });
});

// ---------------------------------------------------------------------------------------------
// TEACH-237: the frames are base4's; the set flow is base4's, with 2-panel strips at the wide size
// and sets of 3 or 4 as single pictures (or one 2x2 grid behind its setting).
// ---------------------------------------------------------------------------------------------

const labSource = (f: string) =>
  readFileSync(join(import.meta.dir, "..", "prompts", "base4-pins", f), "utf8");

describe("the grid opener is the prompt-engineer's, byte for byte", () => {
  test("pinned at the lab's PINS.json hash and filled by code", () => {
    const pin = labSource("tile-grid.tilesgen.txt");
    const sha = (t: string) => createHash("sha256").update(t).digest("hex");
    expect(sha(pin)).toBe("bf7f85b656a692e9cbbb3f4273f1f28d66dbc7764e69bb73f09383037bc97edd");
    expect(TILE_GRID_OPENER).toBe(pin);
    const p = gridImagePrompt(["A chick", "A young hen", "A hen"]).split("\n");
    expect(p[0]).toBe(
      "One image divided into a 2 by 2 grid of 4 equal panels separated by thin pure white gaps, each subject centred in its own panel with clear margin on every side, never crossing a gap. Left to right, top to bottom: (1) A chick; (2) A young hen; (3) A hen; (4) A chick.",
    );
    expect(p.slice(1)).toEqual(setImagePrompt(["A chick", "A hen"]).split("\n").slice(1));
  });
});

describe("the generation prompts are base4's, byte for byte", () => {
  const lab = labSource("picture-set.base4.lab-source.txt");
  const bank = labSource("image-bank.base4.lab-source.txt");
  const fixed = (prompt: string) =>
    prompt
      .split("\n")
      .filter((l) => !/^(?:One image divided|.*\(1\) )/.test(l) && !l.startsWith("A chick"));
  test("every fixed line of the strip, one-panel and solo frames is in the lab source", () => {
    const lines = [
      ...fixed(setImagePrompt(["A chick", "A hen"])),
      ...fixed(setImagePrompt(["A chick", "A hen"], undefined, false)),
      ...setImagePrompt(["A chick"]).split("\n").slice(1),
      ...soloImagePrompt("A chick").split("\n").slice(1),
    ];
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) expect(lab).toContain(JSON.stringify(line).slice(1, -1));
    expect(lab).toContain(
      [
        "`One image divided into ",
        "{n} equal side-by-side panels separated by thin pure white gaps. Left to right: ",
        "{shows",
      ].join("$"),
    );
    expect(lab).toContain(
      ["`One single photograph, not divided into panels: ", "{shows"].join("$"),
    );
  });
  test("the single-picture frame and no-text lines are the lab's", () => {
    for (const faithful of [false, true])
      for (const line of directedImagePrompt("A hen.", faithful).split("\n").slice(1))
        expect(bank).toContain(`"${line}"`);
  });
  test("every generation carries the no-text line and no locale line with example objects", () => {
    const noText =
      "No text anywhere in the image: no words, letters, labels, signs, captions or numbers.";
    for (const p of [
      setImagePrompt(["A chick", "A hen"]),
      setImagePrompt(["A chick"]),
      soloImagePrompt("A chick"),
      directedImagePrompt("A hen.", false),
    ]) {
      expect(p).toContain(noText);
      // The locale is the director's: its image prompt names the country only when what pupils
      // see differs; code adds no country line, so no example objects (pound coins) leak in.
      expect(p).not.toMatch(/\b(?:UK|England|British|pound|£)\b/);
    }
  });
});

/** A light strip of n panels split by white gutters; panel k holds a dark square of sizes[k]. */
function stripPng(sizes: number[], w = 120, h = 120): Uint8Array {
  const width = sizes.length * w + 10 * (sizes.length - 1);
  const rgb = new Uint8Array(width * h * 3).fill(236);
  sizes.forEach((s, k) => {
    const x0 = k * (w + 10);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * width + x0 + x) * 3;
        if (Math.abs(x - w / 2) < s / 2 && Math.abs(y - h / 2) < s / 2) rgb.fill(40, o, o + 3);
      }
    if (k < sizes.length - 1)
      for (let y = 0; y < h; y++)
        rgb.fill(255, (y * width + x0 + w) * 3, (y * width + x0 + w + 10) * 3);
  });
  return encodePng({ width, height: h, rgb });
}

function fakes(opts: {
  strips: Uint8Array[];
  panelOk?: (ask: SetAsk, call: number) => boolean;
  set?: { same: boolean; odd: number[] };
  allow?: boolean;
}) {
  const prompts: string[] = [];
  const judged: string[] = [];
  const logs: Record<string, unknown>[] = [];
  let made = 0;
  let saved = 0;
  const generator: Pick<ImageGenerator, "model" | "generate"> = {
    model: "gpt-image-2.5-sunburst",
    async generate({ prompt, size }) {
      prompts.push(`${size} ${prompt.split("\n")[0]}`);
      const bytes = opts.strips[Math.min(made, opts.strips.length - 1)] ?? new Uint8Array();
      made += 1;
      return {
        bytes,
        mime: "image/png",
        usage: { inputTokens: 1, outputTokens: 1 },
        costUsd: 0.005,
        ms: 1,
      };
    },
  };
  let calls = 0;
  const deps: PictureSetDeps = {
    generator,
    save: async () => {
      saved += 1;
      return { id: `id${saved}`, src: `/files/sets/id${saved}.png` };
    },
    judgePanel: async (ask) => {
      judged.push(ask.key);
      return { ok: opts.panelOk?.(ask, calls++) ?? true };
    },
    judgeSet: async () => opts.set,
    ...(opts.allow === undefined ? {} : { allow: () => opts.allow as boolean }),
    log: (e) => logs.push(e),
  };
  return { deps, prompts, judged, logs, made: () => made };
}

const asks = (n: number): SetAsk[] =>
  ["A newly hatched chick", "A growing young chicken", "An adult hen", "An old hen"]
    .slice(0, n)
    .map((shows, k) => ({ key: `p${k}`, index: 3, shows, mustSee: [], aspect: 1 }));

/** A light 2x2 grid with white gutters; cell k holds a dark square of sizes[k]. */
function gridPng(sizes: number[], w = 150, h = 100): Uint8Array {
  const width = 2 * w + 10;
  const height = 2 * h + 10;
  const rgb = new Uint8Array(width * height * 3).fill(255);
  sizes.forEach((s, k) => {
    const x0 = (k % 2) * (w + 10);
    const y0 = Math.floor(k / 2) * (h + 10);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = ((y0 + y) * width + x0 + x) * 3;
        const inside = Math.abs(x - w / 2) < s / 2 && Math.abs(y - h / 2) < s / 2;
        rgb.fill(inside ? 40 : 236, o, o + 3);
      }
  });
  return encodePng({ width, height, rgb });
}

describe("the set flow", () => {
  test("2 panels: one wide strip places both, each at its own panel shape", async () => {
    const f = fakes({ strips: [stripPng([30, 50])], set: { same: true, odd: [] } });
    const out = await makePictureSet(asks(2), f.deps);
    expect(out.map((p) => p?.key)).toEqual(["p0", "p1"]);
    expect(f.made()).toBe(1);
    expect(f.prompts[0]).toStartWith("2048x1152 One image divided into 2 equal");
    expect(out[0]?.source.provider).toBe("generated");
    expect(out[0]?.set).toBe("p0+p1");
    // Whole panels (120 wide less a 2 px inset each side, 120 tall): nothing cropped to the slot.
    expect(out[0]?.aspect).toBeCloseTo(116 / 120, 3);
  });
  test("a strip that repeats a panel is refused unjudged; each panel is made alone", async () => {
    const f = fakes({ strips: [stripPng([40, 40]), stripPng([30])] });
    const out = await makePictureSet(asks(2), f.deps);
    expect(STRIP_ATTEMPTS).toBe(1);
    expect(f.logs.some((l) => l.ev === "set-error" && /repeats a panel/.test(String(l.err)))).toBe(
      true,
    );
    expect(f.made()).toBe(3);
    expect(f.prompts.slice(1).every((p) => p.startsWith("1024x1024 One single photograph"))).toBe(
      true,
    );
    expect(out.every((p) => p?.set.includes("#solo"))).toBe(true);
  });
  test("one panel fails its judge: no second strip, one solo for that panel only", async () => {
    const f = fakes({
      strips: [stripPng([30, 50]), stripPng([60])],
      panelOk: (ask, call) => !(ask.key === "p1" && call < 2),
      set: { same: true, odd: [] },
    });
    const out = await makePictureSet(asks(2), f.deps);
    expect(f.made()).toBe(2);
    expect(f.judged).toEqual(["p0", "p1", "p1"]);
    expect(out.map((p) => p?.set)).toEqual(["p0+p1", "p0+p1#solo1"]);
  });
  test("the set judge's odd panel is remade alone; a failed solo leaves only that slot empty", async () => {
    const f = fakes({
      strips: [stripPng([30, 50]), stripPng([60])],
      panelOk: (_ask, call) => call < 2,
      set: { same: false, odd: [1] },
    });
    const out = await makePictureSet(asks(2), f.deps);
    expect(out.map((p) => p?.key)).toEqual(["p0", undefined]);
    expect(f.made()).toBe(2);
  });
  test("3 or 4 panels by default: single pictures, judged alone and as a set, never a strip", async () => {
    const f = fakes({
      strips: [stripPng([30]), stripPng([50]), stripPng([70]), stripPng([60])],
      panelOk: (ask, call) => !(ask.key === "p2" && call < 3),
      set: { same: true, odd: [] },
    });
    const out = await makePictureSet(asks(3), f.deps);
    expect(setMode(3)).toBe("solo");
    expect(f.made()).toBe(4);
    expect(f.prompts.every((p) => p.startsWith("1024x1024 One single photograph"))).toBe(true);
    expect(out.map((p) => p?.set)).toEqual(["p0+p1+p2#solo", "p0+p1+p2#solo", "p0+p1+p2#solo2"]);
  });
  test("the grid setting: one 2x2 grid; a set of 3 uses its spare cell for a refused picture", async () => {
    const f = fakes({
      strips: [gridPng([20, 40, 60, 24])],
      // cell 0 (p0) fails; cell 3 is p0's spare and passes
      panelOk: (_ask, call) => call !== 0,
      set: { same: true, odd: [] },
    });
    f.deps.grid = true;
    const out = await makePictureSet(asks(3), f.deps);
    expect(f.made()).toBe(1);
    expect(f.prompts[0]).toStartWith(
      "1536x1024 One image divided into a 2 by 2 grid of 4 equal panels",
    );
    expect(out.map((p) => p?.key)).toEqual(["p0", "p1", "p2"]);
    expect(f.logs.find((l) => l.ev === "grid-pick")?.pick).toEqual([3, 1, 2]);
    expect(out[0]?.aspect).toBeCloseTo(1.5, 1);
  });
  test("the daily cap spent: no generation call, every slot keeps its placeholder, one log line", async () => {
    for (const n of [2, 3]) {
      const f = fakes({ strips: [stripPng([30, 50])], allow: false });
      const out = await makePictureSet(asks(n), f.deps);
      expect(out).toEqual(asks(n).map(() => undefined));
      expect(f.made()).toBe(0);
      expect(f.logs.filter((l) => l.ev === "set-capped")).toHaveLength(1);
    }
  });
  test("named things and history are not generated sets (ruling 163)", () => {
    expect(setIsGenerated(asks(2), "science")).toBe(true);
    expect(setIsGenerated(asks(2), "history")).toBe(false);
    expect(
      setIsGenerated(
        asks(2).map((a, k) => (k === 0 ? { ...a, named: true } : a)),
        "science",
      ),
    ).toBe(false);
    expect(
      setIsGenerated(
        [
          { key: "a", index: 1, shows: "The high street in 1900", mustSee: [] },
          { key: "b", index: 1, shows: "The same street in 2000", mustSee: [] },
        ],
        "geography",
      ),
    ).toBe(false);
  });
});

/* A budget stop is never a missing panel: it stops the set, so no more paid pictures are made. */
describe("the set flow: a budget stop stops the set", () => {
  const budget = () => new BudgetExceeded("usd");
  test("in the panel judge: the set rejects and no solo is made", async () => {
    const f = fakes({ strips: [stripPng([30, 50])] });
    f.deps.judgePanel = async () => {
      throw budget();
    };
    await expect(makePictureSet(asks(2), f.deps)).rejects.toBeInstanceOf(BudgetExceeded);
    expect(f.made()).toBe(1);
  });
  test("in the set judge: the set rejects and no solo is made", async () => {
    const f = fakes({ strips: [stripPng([30, 50])] });
    f.deps.judgeSet = async () => {
      throw budget();
    };
    await expect(makePictureSet(asks(2), f.deps)).rejects.toBeInstanceOf(BudgetExceeded);
    expect(f.made()).toBe(1);
  });
  test("in a solo: the set rejects instead of leaving that slot empty", async () => {
    const f = fakes({ strips: [stripPng([30, 50]), stripPng([60])], set: { same: true, odd: [] } });
    let calls = 0;
    f.deps.judgePanel = async (ask) => {
      calls += 1;
      // The strip's two panels are judged first (p1 fails); the third call is p1's solo.
      if (calls === 3) throw budget();
      return { ok: ask.key !== "p1" };
    };
    await expect(makePictureSet(asks(2), f.deps)).rejects.toBeInstanceOf(BudgetExceeded);
    expect(f.made()).toBe(2);
  });
  test("in the solo generator: the set rejects", async () => {
    const f = fakes({ strips: [stripPng([30, 50])], panelOk: (a) => a.key !== "p1" });
    const strip = f.deps.generator.generate;
    let n = 0;
    f.deps.generator = {
      model: f.deps.generator.model,
      generate: async (req) => {
        n += 1;
        if (n > 1) throw budget();
        return strip(req);
      },
    };
    await expect(makePictureSet(asks(2), f.deps)).rejects.toBeInstanceOf(BudgetExceeded);
  });
});

describe("C4: the set judge beside the panel judges (TEACH-110 part h)", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const timed = (opts: { panelMs: number; setMs: number; odd: number[]; failPanel?: string }) => {
    const f = fakes({ strips: [stripPng([30]), stripPng([50]), stripPng([70]), stripPng([60])] });
    const t0 = performance.now();
    const at = () => performance.now() - t0;
    const marks: Record<string, number> = {};
    let gens = 0;
    const generate = f.deps.generator.generate;
    f.deps.generator = {
      model: f.deps.generator.model,
      generate: async (req) => {
        gens += 1;
        if (gens > 4) marks[`regen${gens - 4}`] ??= at();
        return generate(req);
      },
    };
    let firstRound = true;
    f.deps.judgePanel = async (ask) => {
      marks[`panel:${ask.key}`] ??= at();
      await sleep(opts.panelMs);
      if (ask.key === "p3") firstRound = false;
      return { ok: !(firstRound && ask.key === opts.failPanel) };
    };
    f.deps.judgeSet = async () => {
      marks.set ??= at();
      await sleep(opts.setMs);
      marks.setDone ??= at();
      return { same: opts.odd.length === 0, odd: opts.odd };
    };
    return { f, marks, run: () => makePictureSet(asks(4), f.deps), at };
  };

  test("the set judge starts with the panel judges; odd panels regenerate on its verdict", async () => {
    const t = timed({ panelMs: 80, setMs: 30, odd: [1, 2, 3] });
    const out = await t.run();
    expect(Math.abs((t.marks.set ?? 99) - (t.marks["panel:p0"] ?? 0))).toBeLessThan(15);
    // the regenerations start once the set judge has spoken, before the panel judges end
    expect(t.marks.regen1 ?? 999).toBeLessThan((t.marks["panel:p0"] ?? 0) + 80);
    expect(t.marks.regen1 ?? 0).toBeGreaterThanOrEqual(t.marks.setDone ?? 0);
    // same verdicts and placements as judging one after the other: 1 kept, 3 made alone
    expect(t.f.made()).toBe(7);
    expect(out.map((p) => p?.set)).toEqual([
      "p0+p1+p2+p3#solo",
      "p0+p1+p2+p3#solo1",
      "p0+p1+p2+p3#solo2",
      "p0+p1+p2+p3#solo3",
    ]);
  });

  test("a panel its own judge fails regenerates before the set judge answers", async () => {
    const t = timed({ panelMs: 10, setMs: 80, odd: [], failPanel: "p2" });
    const out = await t.run();
    expect(t.marks.regen1 ?? 999).toBeLessThan(t.marks.setDone ?? 0);
    expect(t.f.made()).toBe(5);
    expect(out.map((p) => p?.set)).toEqual([
      "p0+p1+p2+p3#solo",
      "p0+p1+p2+p3#solo",
      "p0+p1+p2+p3#solo2",
      "p0+p1+p2+p3#solo",
    ]);
  });
});

describe("card pictures are made at their slot's shape (TEACH-110 part h)", () => {
  const sizesFor = async (n: number, aspect: number, panelOk?: (a: SetAsk) => boolean) => {
    const f = fakes({
      strips: [stripPng([30, 50]), stripPng([30]), stripPng([50]), stripPng([70]), stripPng([60])],
      ...(panelOk ? { panelOk: (a: SetAsk, call: number) => call >= n || panelOk(a) } : {}),
      set: { same: true, odd: [] },
    });
    await makePictureSet(
      asks(n).map((a) => ({ ...a, aspect })),
      f.deps,
    );
    return f.prompts.map((p) => p.split(" ")[0]);
  };
  test("sets of 4: 4:3 cards ask for 1536x1024, square for 1024x1024, portrait for 1024x1536", async () => {
    expect(new Set(await sizesFor(4, 184 / 138))).toEqual(new Set(["1536x1024"]));
    expect(new Set(await sizesFor(4, 1))).toEqual(new Set(["1024x1024"]));
    expect(new Set(await sizesFor(4, 0.7))).toEqual(new Set(["1024x1536"]));
  });
  test("a panel's fallback asks for the same shape; strips keep their wide size", async () => {
    const sizes = await sizesFor(4, 184 / 138, (a) => a.key !== "p1");
    expect(sizes).toHaveLength(5);
    expect(new Set(sizes)).toEqual(new Set(["1536x1024"]));
    const strip = await sizesFor(2, 184 / 138, (a) => a.key !== "p1");
    expect(strip).toEqual(["2048x1152", "1536x1024"]);
  });
});
