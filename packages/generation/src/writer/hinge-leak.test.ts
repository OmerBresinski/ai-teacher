import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writerBundle } from "./bundle";
import { answerFirst, keepAnswerKey, shuffleHinge } from "./fixes";
import { hingeLeakFaults, leakedStems } from "./hinge-leak";
import { replayRun, replayServices } from "./replay-fixture";

/*
 * TEACH-247 part bp: a hinge whose right option alone repeats a question word (by its first 5
 * letters) goes to the one-slide repair. Option sets: every hinge of the saved writer outputs in
 * the v4.17 and v4.18c gate-B sets and the v4.18d and v4.18e tier-1 sets
 * (scratchpad/tuning/runs/v4.18c-gateB/runs-v417.txt, runs-v418c.txt,
 * tier1-28oct/runs-v418d.txt, runs-v418e.txt), lifted from each run's debug.json writer-output.
 */
type S = Record<string, unknown>;
type Set0 = { run: string; where: string; stem: string; options: S[]; slide: S };
const SETS = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/hinge-leak-sets.json"), "utf8"),
) as Record<"v417" | "v418c" | "v418d" | "v418e", Set0[]>;
const find = (v: keyof typeof SETS, run: string, where: string): S => {
  const hit = SETS[v].find((s) => s.run === run && s.where === where);
  if (!hit) throw new Error(`no saved hinge ${v} ${run} ${where}`);
  return hit.slide;
};
const RIVERS = find("v417", "record-y9-rivers-r1-v417", "s5");
const ROMANS = find("v417", "record-y4-romans-r2-v417", "s7");
const CHLOROPHYLL = find("v418d", "record-y8-photosynthesis-r1-v418d", "s7");

/** The hinge as the stage checks it: answer first keyed at 1, then the seeded shuffle. */
const staged = (s: S, seed = "x") => shuffleHinge(answerFirst(s), seed);

describe("hingeLeakFaults: the saved hinges that leaked", () => {
  test("v4.18d chlorophyll: the fault line, word for word", () => {
    expect(hingeLeakFaults(answerFirst(CHLOROPHYLL))).toEqual([
      'leak: options[0], the answer, is the only option that repeats the heading\'s "chlorophyll" (as "chloroplasts"), so the word gives the answer away. Keep options[0] word for word. Reword the heading without that word, or reword a wrong option (options[1], options[2]) to use it too while it keeps the misconception it tests.',
    ]);
  });

  test("v4.17 Romans gates and Rivers attrition", () => {
    expect(hingeLeakFaults(answerFirst(ROMANS))[0]).toContain(
      'the heading\'s "gates", so the word',
    );
    expect(hingeLeakFaults(answerFirst(RIVERS))[0]).toContain(
      'the heading\'s "smaller" and "collisions" (as "collide"), so the words give the answer away',
    );
  });

  test("after the shuffle the line names the answer where it now sits", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const s = staged(CHLOROPHYLL, seed);
      const k = Number(s.correct) - 1;
      const [f] = hingeLeakFaults(s);
      expect(f).toStartWith(`leak: options[${k}], the answer,`);
      expect(f).not.toContain(`options[${k}]) to use`);
    }
  });

  test("the writer's answer-first shape (no correct, the answer has no why) is read too", () => {
    expect(hingeLeakFaults(CHLOROPHYLL)).toEqual(hingeLeakFaults(answerFirst(CHLOROPHYLL)));
  });
});

describe("hingeLeakFaults: no false flags on the saved option sets", () => {
  test("none of the 25 v4.18c option sets is flagged", () => {
    expect(SETS.v418c).toHaveLength(25);
    for (const s of SETS.v418c) {
      expect(hingeLeakFaults(answerFirst(s.slide))).toEqual([]);
      expect(hingeLeakFaults(staged(s.slide))).toEqual([]);
    }
  });

  test("across all 53 sets exactly the 3 known leaks are flagged", () => {
    const flagged = Object.entries(SETS).flatMap(([v, list]) =>
      list
        .filter((s) => hingeLeakFaults(staged(s.slide)).length)
        .map((s) => `${v} ${s.run} ${s.where}`),
    );
    expect(flagged.sort()).toEqual([
      "v417 record-y4-romans-r2-v417 s7",
      "v417 record-y9-rivers-r1-v417 s5",
      "v418d record-y8-photosynthesis-r1-v418d s7",
    ]);
  });

  test("the rule is score.ts's: stems the right option alone shares with the question", () => {
    expect(
      leakedStems("Where is chlorophyll found in leaf cells?", "Inside chloroplasts", [
        "In the nucleus",
        "In the cell wall",
      ]),
    ).toEqual(["chlor"]);
    // A wrong option sharing the word clears it; short and stop words never count.
    expect(leakedStems("How did gates help?", "Through the gates", ["Gates were shut"])).toEqual(
      [],
    );
    expect(leakedStems("What is 3 of 20 and how?", "What 20 how", ["x"])).toEqual([]);
  });

  test("not a hinge, or no single answer: no fault", () => {
    expect(hingeLeakFaults({ ...answerFirst(CHLOROPHYLL), template: "explain" })).toEqual([]);
    const opts = (CHLOROPHYLL.options as S[]).map((o) => ({ ...o, why: null }));
    expect(hingeLeakFaults({ ...CHLOROPHYLL, options: opts })).toEqual([]);
  });

  test("the stem is the question when the slide has one (base bundles)", () => {
    const s = {
      template: "hinge",
      heading: "Choose",
      stem: "What is a fifth of 20 apples?",
      options: ["4 apples", "5", "15"],
      correct: 1,
    };
    expect(hingeLeakFaults(s)[0]).toStartWith(
      'leak: options[0], the answer, is the only option that repeats the stem\'s "apples"',
    );
  });
});

describe("keepAnswerKey on a pack hinge (options are {text, icon, why})", () => {
  test("the answer is found by its text, not String(object)", () => {
    const before = staged(CHLOROPHYLL, "b");
    const k = Number(before.correct) - 1;
    const opts = before.options as S[];
    // The repair moved the answer to the end and reworded the heading.
    const moved = [...opts.filter((_, i) => i !== k), opts[k]];
    const after = {
      ...before,
      heading: "Where in a leaf cell is the green pigment?",
      options: moved,
    };
    expect(keepAnswerKey(before, after)?.correct).toBe(moved.length);
    // An answer reworded is lost: the slide is kept as it was.
    const reworded = moved.map((o, i) =>
      i === moved.length - 1 ? { ...o, text: "In chloroplasts" } : o,
    );
    expect(keepAnswerKey(before, { ...after, options: reworded })).toBeNull();
  });
});

describe("stage: a leaky hinge goes to the one-slide repair", () => {
  // y5 fractions writer slide 6 (lesson slide 8, after the title and objectives) is a hinge
  // ("What is ⅗ of 20?"); the test rewrites it to leak "apples".
  const B = "y5-maths-fractions-of-amounts";
  const LEAKY = {
    template: "hinge",
    heading: "Choose the answer",
    stem: "What is a fifth of 20 apples?",
    options: ["4 apples", "5", "15", "100"],
    correct: 1,
  };
  const text = (t: string) => {
    const w = JSON.parse(t) as { slides: S[] };
    w.slides[5] = LEAKY;
    return JSON.stringify(w);
  };
  const REPAIR = writerBundle().repair;

  async function run(reply: S) {
    const events: S[] = [];
    const asked: { system: string; user: string }[] = [];
    const base = replayServices(B);
    await replayRun(B, {
      text,
      services: {
        ...base,
        log: (e) => events.push(e as S),
        chat: async (r) => {
          if (r.name === "slide" && r.user.includes("leak: ")) {
            asked.push({ system: r.system, user: r.user });
            return { out: reply, usd: 0, ms: 0 };
          }
          return base.chat(r);
        },
      },
    });
    return { events, asked, repair: events.filter((e) => e.ev === "repair" && e.slide === 8) };
  }

  test("one repair request carries the leak line; a reworded stem is kept", async () => {
    const r = await run({
      fix: "reference",
      slide: { ...LEAKY, stem: "What is a fifth of 20?" },
      to_notes: "none",
    });
    expect(r.asked).toHaveLength(1);
    expect(r.asked[0]?.system).toBe(REPAIR);
    expect(r.asked[0]?.user).toMatch(
      /leak: options\[\d\], the answer, is the only option that repeats the stem's "apples", so the word gives the answer away\./,
    );
    expect(r.repair).toEqual([expect.objectContaining({ ok: true, reverted: false })]);
  });

  test("a repaired slide that still leaks is not kept", async () => {
    const r = await run({ fix: "reference", slide: LEAKY, to_notes: "none" });
    expect(r.asked.length).toBeGreaterThanOrEqual(1);
    expect(r.repair).toEqual([expect.objectContaining({ ok: true, reverted: true })]);
  });
});
