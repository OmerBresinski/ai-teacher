import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Brief } from "./fixes";
import type { VisualAsk, VisualState } from "./materialise";
import { recordedHeld, recordedVisuals, replayServices } from "./replay-fixture";
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
