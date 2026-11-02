import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Brief } from "./fixes";
import type { VisualAsk, VisualState } from "./materialise";
import { recordedHeld, recordedVisuals, replayRun, replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * TEACH-247 part cw, a $0 replay: the recorded y1 deck with its last practice slide's picture
 * written as v4.21b's pre-check found most reused pictures are, naming the answer. The picture is
 * never asked for, `check-look-leak` is logged with what happens next (`next: "cj"`), and cj then decides
 * the slide (a lent visual or its own logged skip). The deck as recorded drops nothing.
 */
const B = "y1-science-animals-young";
const DIR = join(import.meta.dir, "fixtures/replay", B);
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));
type E = Record<string, unknown>;

async function replay(edit?: (slides: E[]) => void) {
  const main = JSON.parse((read("main.json") as { text: string }).text) as { slides: E[] };
  edit?.(main.slides);
  const events: E[] = [];
  const asked: string[] = [];
  const rec = recordedVisuals(B);
  const out = await runWriter({
    brief: read("brief.json") as Brief,
    objectives: (read("objectives.json") as { objectives: { teacher: string }[] }).objectives.map(
      (o) => o.teacher,
    ),
    services: {
      ...replayServices(B),
      log: (e: E) => events.push(e),
      writer: async () => ({ text: JSON.stringify(main), finishReason: "stop", usd: 0, ms: 0 }),
    },
    visual: (i: number, key: string, a: VisualAsk): VisualState => {
      asked.push(`${i}:${key}:${a.shows ?? ""}`);
      return rec(i, key, a);
    },
    held: recordedHeld(B),
  });
  return { out, events, asked };
}

describe("a writer's check picture that names the answer is dropped before it is asked for", () => {
  test("the leaking practice picture: logged, never asked for, then left to cj", async () => {
    const LEAK = "A hen with long feathers beside a fluffy chick";
    const { events, asked, out } = await replay((slides) => {
      const s = slides[8] as E;
      expect(s.template).toBe("practice");
      s.items = [
        { question: "What does a hen have that a chick does not?", answer: "Long feathers" },
      ];
      delete s.questions;
      s.picture = { shows: LEAK, must_see: ["long adult feathers"], subject: "generic" };
    });
    const leaks = events.filter((e) => e.ev === "check-look-leak");
    expect(leaks).toHaveLength(1);
    const leak = leaks[0] as E;
    expect(leak).toMatchObject({ template: "practice", key: "picture", origin: "writer" });
    expect(leak.next).toBe("cj");
    expect(String(leak.why)).toContain("feather");
    // Never searched for or drawn.
    expect(asked.some((a) => a.endsWith(LEAK))).toBe(false);
    expect(JSON.stringify(out.slides)).not.toContain(LEAK);
    // cj decided the slide: a lent visual or a logged skip, never silence.
    const cj = events.filter(
      (e) => (e.ev === "check-visual" || e.ev === "check-visual-skip") && e.slide === leak.slide,
    );
    expect(cj).toHaveLength(1);
  });

  test("the recorded deck: no check picture names an answer, nothing is dropped", async () => {
    const { events } = await replay();
    expect(events.filter((e) => e.ev === "check-look-leak")).toEqual([]);
  });
});

describe("a repair's rewrite of a check slide is screened again (review of #752)", () => {
  // y5 fractions writer slide 6 (lesson slide 8) is a hinge; written to leak "apples" it goes to
  // the one-slide repair (hinge-leak.test.ts), whose reply here also asks for a figure that
  // names the answer.
  const B5 = "y5-maths-fractions-of-amounts";
  const LEAKY = {
    template: "hinge",
    heading: "Choose the answer",
    stem: "What is a fifth of 20 apples?",
    options: ["4 apples", "5", "15", "100"],
    correct: 1,
  };
  test("a picture the repair adds that names the answer is dropped and logged", async () => {
    const events: E[] = [];
    const base = replayServices(B5);
    await replayRun(B5, {
      text: (t: string) => {
        const w = JSON.parse(t) as { slides: E[] };
        w.slides[5] = LEAKY;
        return JSON.stringify(w);
      },
      checks: "log",
      services: {
        ...base,
        log: (e) => events.push(e as E),
        chat: async (r) =>
          r.name === "slide" && r.user.includes("leak: ")
            ? {
                out: {
                  fix: "reference",
                  slide: {
                    ...LEAKY,
                    stem: "What is a fifth of 20?",
                    figure: { shows: "Four red counters in a row", must_see: ["4 counters"] },
                  },
                  to_notes: "none",
                },
                usd: 0,
                ms: 0,
              }
            : base.chat(r),
      },
    });
    expect(events.filter((e) => e.ev === "repair" && e.slide === 8)).toEqual([
      expect.objectContaining({ ok: true }),
    ]);
    expect(events.filter((e) => e.ev === "check-look-leak" && e.slide === 8)).toEqual([
      expect.objectContaining({ key: "figure", origin: "repair", next: "cj" }),
    ]);
    // cj had lent the slide a diagram: with the leaking figure dropped, it goes back on the
    // rewrite and the repair is kept (no visual lost, no second lend).
    expect(events.filter((e) => e.ev === "repair-rejected" && e.slide === 8)).toEqual([]);
  });
});
