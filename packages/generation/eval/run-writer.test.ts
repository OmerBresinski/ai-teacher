import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Lesson } from "@tj/domain/documents";
import { evalBriefs } from "./briefs";
import type { WriterEvent } from "./fill";
import { formatWriterTable, parseEvalArgs, pickBriefs, writerRow } from "./run";
import type { BriefResult } from "./run-brief";

const DIR = join(import.meta.dir, "fixtures", "writer-fill");
const raw = readFileSync(join(DIR, "y4-romans.writer-raw.txt"), "utf8");
const events = readFileSync(join(DIR, "y4-romans.events.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as WriterEvent);
const lesson = { ageBand: "ks2", yearGroup: "Year 4", slides: [] } as unknown as Lesson;
const result = { id: "y4-romans", ok: true, slides: 14 } as BriefResult;
const tap = (text: string) => ({ text, slidesKeyMs: 1, usage: null });

describe("eval:paid arguments (TEACH-110 part af)", () => {
  test("brief filter, judge off, planner, plan-only", () => {
    expect(parseEvalArgs([])).toEqual({ judge: true, planOnly: false });
    expect(parseEvalArgs(["--briefs", "a, b", "--no-judge", "--planner", "writer"])).toEqual({
      briefs: ["a", "b"],
      judge: false,
      planOnly: false,
      planner: "writer",
    });
    expect(parseEvalArgs(["--plan-only"])).toMatchObject({ planOnly: true, planner: "writer" });
    expect(() => parseEvalArgs(["--plan-only", "--planner", "legacy"])).toThrow("writer planner");
    expect(() => parseEvalArgs(["--planner", "x"])).toThrow("--planner");
    expect(() => parseEvalArgs(["--bogus"])).toThrow();
  });

  test("picks briefs by id in the given order; an unknown id throws", () => {
    const all = evalBriefs();
    const [a, b] = [all[3]?.id ?? "", all[0]?.id ?? ""];
    expect(pickBriefs(all, [a, b]).map((x) => x.id)).toEqual([a, b]);
    expect(pickBriefs(all, undefined)).toHaveLength(all.length);
    expect(() => pickBriefs(all, ["no-such-brief"])).toThrow('no brief "no-such-brief"');
  });
});

describe("writer row", () => {
  test("full: fill score and the plan check from the finished output", () => {
    const m = writerRow({ result, lesson, writer: { tap: tap(raw), events } }, "full");
    expect(m?.row).toMatchObject({
      id: "y4-romans",
      stage: "KS2",
      deckLength: 14,
      plannedSlides: 10,
    });
    expect(m?.row.fill?.body.fields).toBeGreaterThan(0);
    expect(m?.row.planFit?.checked).toBe(5);
    expect(formatWriterTable({ lessons: m ? [m.row] : [], fill: m?.row.fill ?? null })).toContain(
      "| y4-romans | KS2 | 10 | 14 |",
    );
  });

  test("plan-only: the plan check alone, and the cut call's settled cost", () => {
    const cut = raw.slice(0, raw.indexOf('"slides"') + 12);
    const m = writerRow(
      {
        result: { ...result, ok: false },
        lesson,
        writer: { tap: tap(cut), events: [], cut: { inputTokens: 5000, outputTokens: 2700 } },
      },
      "plan-only",
    );
    expect(m?.row.fill).toBeUndefined();
    expect(m?.row.deckLength).toBeNull();
    expect(m?.row.planFit?.counts).toEqual({
      fits: 2,
      "near-cap": 3,
      over: 0,
      "no-cell": 0,
      unparsed: 0,
    });
    // What settleCut charged, at Sol 6.1's $2 / $10 per million: 5000 in + 2700 out.
    expect(m?.row.planWriterUsdEstimate).toBeCloseTo(0.037, 9);
  });
});
