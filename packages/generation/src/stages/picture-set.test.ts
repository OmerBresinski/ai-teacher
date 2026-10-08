import { describe, expect, test } from "bun:test";
import { isHistoricalSet, isSameSubjectSet, setImagePrompt, setSize } from "./picture-set";

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
    expect(setSize(2)).toBe("1536x1024");
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
// TEACH-237: the frames are base4's, and the set flow runs as base4 ran it.
// ---------------------------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { directedImagePrompt, encodePng, type ImageGenerator } from "@tj/images";
import {
  makePictureSet,
  type PictureSetDeps,
  type SetAsk,
  STRIP_ATTEMPTS,
  setIsGenerated,
  soloImagePrompt,
} from "./picture-set";

const labSource = (f: string) =>
  readFileSync(join(import.meta.dir, "..", "prompts", "base4-pins", f), "utf8");

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

describe("the set flow (base4: one strip, then solos)", () => {
  test("a good strip places every panel from one generation", async () => {
    const f = fakes({ strips: [stripPng([30, 50, 70])], set: { same: true, odd: [] } });
    const out = await makePictureSet(asks(3), f.deps);
    expect(out.map((p) => p?.key)).toEqual(["p0", "p1", "p2"]);
    expect(f.made()).toBe(1);
    expect(f.prompts[0]).toStartWith("2048x1152 One image divided into 3 equal");
    expect(out[0]?.source.provider).toBe("generated");
    expect(out[0]?.set).toBe("p0+p1+p2");
  });
  test("a strip that repeats a panel is refused unjudged; each panel is made alone", async () => {
    const f = fakes({ strips: [stripPng([40, 40, 40]), stripPng([30])] });
    const out = await makePictureSet(asks(3), f.deps);
    expect(STRIP_ATTEMPTS).toBe(1);
    expect(f.logs.some((l) => l.ev === "set-error" && /repeats a panel/.test(String(l.err)))).toBe(
      true,
    );
    expect(f.made()).toBe(4);
    expect(f.prompts.slice(1).every((p) => p.startsWith("1024x1024 One single photograph"))).toBe(
      true,
    );
    expect(out.every((p) => p?.set.includes("#solo"))).toBe(true);
  });
  test("one panel fails its judge: no second strip, one solo for that panel only", async () => {
    const f = fakes({
      strips: [stripPng([30, 50, 70]), stripPng([60])],
      panelOk: (ask, call) => !(ask.key === "p1" && call < 3),
      set: { same: true, odd: [] },
    });
    const out = await makePictureSet(asks(3), f.deps);
    expect(f.made()).toBe(2);
    expect(f.judged).toEqual(["p0", "p1", "p2", "p1"]);
    expect(out.map((p) => p?.set)).toEqual(["p0+p1+p2", "p0+p1+p2#solo1", "p0+p1+p2"]);
  });
  test("the set judge's odd panel is remade alone; a failed solo leaves only that slot empty", async () => {
    const f = fakes({
      strips: [stripPng([30, 50, 70]), stripPng([60])],
      panelOk: (_ask, call) => call < 3,
      set: { same: false, odd: [2] },
    });
    const out = await makePictureSet(asks(3), f.deps);
    expect(out.map((p) => p?.key)).toEqual(["p0", "p1", undefined]);
    expect(f.made()).toBe(2);
  });
  test("the daily cap spent: no generation call, every slot keeps its placeholder, one log line", async () => {
    const f = fakes({ strips: [stripPng([30, 50])], allow: false });
    const out = await makePictureSet(asks(2), f.deps);
    expect(out).toEqual([undefined, undefined]);
    expect(f.made()).toBe(0);
    expect(f.logs.filter((l) => l.ev === "set-capped")).toHaveLength(1);
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
