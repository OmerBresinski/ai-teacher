import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { continuePractice } from "./practice-split";
import { runWriter } from "./stage";

/*
 * TEACH-230 part b on the writer's side: practice past its maximum continues on more practice
 * slides, split as evenly as possible (7 is 4 + 3, never 6 + 1), same heading, nothing over.
 */
type S = Record<string, unknown>;
const TASKS = [
  "Write: my brother is called Louis.",
  "Write: my sister is ten.",
  "Write: my mum is kind.",
  "Write: my dad is tall.",
  "Write: I have a cat.",
  "Write: my gran is funny.",
  "Write: I have two cousins.",
];
const text = (s: { elements: S[] }, name: string) =>
  s.elements
    .filter((e) => e.name === name)
    .map((e) => (JSON.stringify(e.doc).match(/"text":"([^"]*)"/g) ?? []).join(""));

describe("practice past its maximum continues (TEACH-230 part b)", () => {
  test("balanced, never one alone; a slide that fits is left alone", () => {
    const fitsAt = (max: number) => (s: S) => (s.questions as string[]).length <= max;
    const s: S = { template: "practice", heading: "H", questions: TASKS, picture: { q: 1 } };
    const pc = continuePractice(s, fitsAt(6));
    if (!pc) throw new Error("not split");
    expect([pc.first, ...pc.rest].map((p) => (p.questions as string[]).length)).toEqual([4, 3]);
    expect(pc?.first.picture).toEqual({ q: 1 });
    expect(pc?.rest[0]?.picture).toBeNull();
    expect(continuePractice({ ...s, questions: TASKS.slice(0, 5) }, fitsAt(6))).toBeUndefined();
    expect(continuePractice({ ...s, template: "exit-ticket" }, fitsAt(1))).toBeUndefined();
  });

  test("end to end: the writer's 7-task practice slide ships as 4 + 3, same heading, in order", async () => {
    const dir = join(import.meta.dir, "fixtures/replay/y8-french-my-family");
    const read = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
    const w = JSON.parse(read("main.json").text);
    const k0 = (w.slides as S[]).findIndex((s) => s.template === "practice");
    expect(k0).toBeGreaterThanOrEqual(0);
    w.slides[k0].questions = TASKS;
    w.slides[k0].picture = null;
    w.slides[k0].figure = null;
    const out = await runWriter({
      brief: read("brief.json"),
      objectives: read("objectives.json").objectives.map((o: { teacher: string }) => o.teacher),
      services: {
        log: () => {},
        writer: () => Promise.reject(new Error("no writer")),
        chat: async () => {
          throw new Error("no paid call");
        },
      },
      visual: () => ({ status: "failed" }),
      recordedWriter: { text: JSON.stringify(w), finishReason: "stop" },
      drawDiagrams: {
        callDrawer: async () => {
          throw new Error("no drawer");
        },
      },
    });
    const ids = out.slides.map((s) => s.id);
    const own = `s${k0 + 3}`; // title and objectives come first
    const at = ids.indexOf(own);
    expect(at).toBeGreaterThan(0);
    expect(ids[at + 1]).toBe(`${own}p1`);
    const parts = [out.slides[at], out.slides[at + 1]] as unknown as { elements: S[] }[];
    expect(parts.map((p) => text(p, "Task").length)).toEqual([4, 3]);
    expect(parts.flatMap((p) => text(p, "Task")).join("")).toContain("two cousins");
    expect(text(parts[0] as never, "Heading")).toEqual(text(parts[1] as never, "Heading"));
  });
});
