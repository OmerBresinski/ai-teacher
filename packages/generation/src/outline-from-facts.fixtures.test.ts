import { describe, expect, test } from "bun:test";
import { SLIDE_COUNTS, type SlideCount } from "@tj/domain/documents";
import macbeth from "./fixtures/objective-facts.ks4-english-literature-macbeth.json";
import elasticity from "./fixtures/objective-facts.post16-economics-elasticity.json";
import romans from "./fixtures/objective-facts.y4-history-romans.json";
import ratio from "./fixtures/objective-facts.y6-maths-ratio.json";
import evolution from "./fixtures/objective-facts.y6-science-evolution.json";
import {
  type OutlineFacts,
  type OutlineFromFactsInput,
  outlineFromFacts,
} from "./outline-from-facts";
import { lessonShapeOf } from "./shapes";
import { assignFactIds, planSkeletonSchemaFor } from "./specs";

/*
 * The outline step over real facts: the five lab briefs' merged per-objective facts
 * (`fixtures/objective-facts.*.json`, gpt-5.6-luna, `plan-facts-objective.v2`, merged by
 * `mergeObjectiveFacts`), at every slide count the brief may ask for (ADR 0029 item 9). The
 * outline a model used to write had to pass `planSkeletonSchemaFor` and then `assignFactIds`;
 * the outline code writes is held to the same two gates, so nothing downstream can tell the
 * difference. `photographable` is the one skeleton field code does not answer, and a required
 * kind the facts hold no material for (a shape that wants a worked example from a facts call that
 * wrote none) is reported in `gaps`, not invented.
 */

const FIXTURES = { romans, ratio, evolution, macbeth, elasticity } as const;
const PITCH = { readingAgeTarget: 10, sentenceLengthMax: 16, avoid: [] };
/** The structural rules, with explain and practise alternating in learning cycles (w0b flow). */
const CycleSkeletonSchema = planSkeletonSchemaFor({ learningCycles: true });

function inputFor(fixture: (typeof FIXTURES)[keyof typeof FIXTURES], slideCount: SlideCount) {
  const facts = fixture.facts as unknown as OutlineFacts;
  const shape = lessonShapeOf(fixture.answers, { yearGroup: fixture.yearGroup });
  const input: OutlineFromFactsInput = {
    topic: fixture.topic,
    objectives: fixture.objectives,
    facts,
    shape,
    slideCount,
  };
  return { input, facts, shape };
}

/**
 * Issues a code-built outline is allowed: the picture question; a kind the facts cannot supply;
 * and, when the deck has no more free slots than objectives (six slides, three objectives), the
 * practise slide that would cost an objective its teaching slide — the step teaches every
 * objective first and says so in `gaps`, and the plan screen is where that trade is shown; the
 * same for a practise share the deck has no room for.
 */
function unexplained(
  issues: { path: PropertyKey[]; message: string }[],
  facts: OutlineFacts,
  input: OutlineFromFactsInput,
  gaps: readonly string[] = [],
) {
  const crowded = input.slideCount - 3 <= input.objectives.length;
  return issues.filter((issue) => {
    if (issue.path[0] === "photographable") return false;
    if (facts.workedExamples.length === 0 && /no worked-example slide/.test(issue.message)) {
      return false;
    }
    if (crowded && /at least one "practise" slide/.test(issue.message)) return false;
    // Ruling 81: with one slot left, the shared practise slide outranks the shape's kind. A kind
    // the facts hold no material for (no question declared askable openly, no owned worked
    // example) is a gap too, never invented.
    const kind = /no ([a-z-]+) slide/.exec(issue.message)?.[1];
    if (kind && gaps.some((g) => g.includes(`needs a ${kind} slide and `))) return false;
    // A share floor the fill could not reach (ruling 81: practice gives way to teaching) has a
    // gap opening with the same sentence as the issue.
    const share = /^At least \d+ of the \d+ slides[^.]*\./.exec(issue.message)?.[0];
    if (share && gaps.some((g) => g.startsWith(share))) return false;
    return true;
  });
}

describe("outlineFromFacts over the five lab briefs", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const slideCount of SLIDE_COUNTS) {
      const { input, facts, shape } = inputFor(fixture, slideCount);
      const result = outlineFromFacts(input);
      const { skeleton, outlineFactRefs } = result;

      describe(`${name} at ${slideCount} slides`, () => {
        test("has exactly slideCount entries, opening title, objectives and closing on the exit ticket", () => {
          expect(skeleton.outline).toHaveLength(slideCount);
          expect(skeleton.outline[0]?.kind).toBe("title");
          expect(skeleton.outline[1]?.kind).toBe("objectives");
          expect(skeleton.outline.at(-1)?.kind).toBe("exit-ticket");
          expect(skeleton.outline.at(-1)?.phase).toBe("check");
          expect(skeleton.learningObjectives).toEqual(fixture.objectives);
        });

        test("no entry carries minutes (ruling 82: the size is the slide count)", () => {
          expect(skeleton.outline.every((e) => e.minutes === undefined)).toBe(true);
        });

        test("passes the skeleton's structural rules", () => {
          const parsed = CycleSkeletonSchema.safeParse(skeleton);
          expect(
            parsed.success ? [] : unexplained(parsed.error.issues, facts, input, result.gaps),
          ).toEqual([]);
        });

        if (slideCount >= 8) {
          test("passes the lesson shape's rules with the brief's slide count", () => {
            const schema = planSkeletonSchemaFor({ shape, slideCount, learningCycles: true });
            const parsed = schema.safeParse(skeleton);
            expect(
              parsed.success ? [] : unexplained(parsed.error.issues, facts, input, result.gaps),
            ).toEqual([]);
          });
        }

        test("merges with the facts into LessonFacts (assignFactIds parses)", () => {
          const merged = assignFactIds(
            skeleton,
            { ...facts, outlineFactRefs, pitch: PITCH },
            fixture.durationMin,
          );
          expect(merged.outline).toHaveLength(slideCount);
          expect(merged.objectives.map((o) => o.text)).toEqual(
            fixture.objectives.map((o) => o.text),
          );
        });

        test("every objective is taught by a content or worked-example slide that names it", () => {
          fixture.objectives.forEach((_, i) => {
            const taught = skeleton.outline.some(
              (e) =>
                (e.kind === "content" || e.kind === "worked-example") &&
                e.factRefs.some((r) => r.type === "objective" && r.index === i),
            );
            expect(taught).toBe(true);
            expect(result.coverage[i]?.taught.length).toBeGreaterThan(0);
          });
        });

        test("every slide from position 2 carries fact references of the kind its slide needs", () => {
          const refsAt = new Map(outlineFactRefs.map((e) => [e.index, e.factRefs]));
          skeleton.outline.forEach((entry, i) => {
            if (i < 2) return;
            const types = new Set((refsAt.get(i) ?? []).map((r) => r.type));
            if (entry.kind === "content") expect(types.has("keyIdea")).toBe(true);
            if (entry.kind === "worked-example") expect(types.has("workedExample")).toBe(true);
            if (entry.kind === "vocabulary") expect(types.has("vocabulary")).toBe(true);
            if (["multiple-choice", "true-false", "open-response"].includes(entry.kind)) {
              expect(types.has("question")).toBe(true);
            }
            if (entry.kind === "true-false") expect(types.has("misconception")).toBe(true);
            expect(entry.brief?.adds.length ?? 0).toBeGreaterThan(0);
            expect(entry.brief?.adds.length ?? 0).toBeLessThanOrEqual(160);
            expect(entry.phase).toBeDefined();
          });
          expect(outlineFactRefs.every((e) => e.index >= 2)).toBe(true);
        });

        test("no question is used twice; the exit quiz holds 1-6 items, every question on it fair (r1)", () => {
          const used = outlineFactRefs.flatMap((e) =>
            e.factRefs.filter((r) => r.type === "question").map((r) => r.index),
          );
          expect(new Set(used).size).toBe(used.length);
          const exitItems =
            outlineFactRefs
              .find((e) => e.index === slideCount - 1)
              ?.factRefs.filter((r) => r.type !== "objective") ?? [];
          expect(exitItems.length).toBeLessThanOrEqual(6);
          for (const r of exitItems) {
            if (r.type !== "question") continue;
            const q = facts.questions[r.index];
            expect(q?.objectiveRefs.every((ref) => !untaught.has(ref.index))).toBe(true);
          }
        });

        const placedKeyIdeas = new Set(
          outlineFactRefs.flatMap((e) =>
            e.factRefs.filter((r) => r.type === "keyIdea").map((r) => r.index),
          ),
        );
        const untaught = new Set(
          facts.keyIdeas.flatMap((k, i) =>
            placedKeyIdeas.has(i) ? [] : k.objectiveRefs.map((r) => r.index),
          ),
        );

        test("every key idea is on a content slide or named in gaps (np1 RC1)", () => {
          facts.keyIdeas.forEach((_, i) => {
            if (placedKeyIdeas.has(i)) return;
            expect(result.gaps.some((g) => g.startsWith(`Key idea ${i + 1} (`))).toBe(true);
          });
          expect(result.unplaced.keyIdeas.every((i) => !placedKeyIdeas.has(i))).toBe(true);
          if (slideCount >= 10) expect(result.unplaced.keyIdeas).toEqual([]);
          for (const entry of outlineFactRefs) {
            expect(entry.factRefs.filter((r) => r.type === "keyIdea").length).toBeLessThanOrEqual(
              2,
            );
          }
        });

        test("no practise or exit question names an objective with a key idea left off", () => {
          for (const entry of outlineFactRefs) {
            for (const ref of entry.factRefs) {
              if (ref.type !== "question") continue;
              const owners = facts.questions[ref.index]?.objectiveRefs ?? [];
              expect(owners.some((o) => untaught.has(o.index))).toBe(false);
            }
          }
        });

        test("briefs are distinct; the starter opens, cycles alternate, the check phase closes", () => {
          const adds = skeleton.outline.slice(2).map((e) => e.brief?.adds);
          expect(new Set(adds).size).toBe(adds.length);
          // Explain and practise alternate in learning cycles; starter first, check last.
          const order = { starter: 0, explain: 1, practise: 1, check: 3 } as const;
          let last = -1;
          for (const entry of skeleton.outline) {
            if (!entry.phase) continue;
            expect(order[entry.phase]).toBeGreaterThanOrEqual(last);
            last = order[entry.phase];
          }
          // Every check comes after the teaching slides of its cycle.
          for (const c of result.cycles) {
            for (const at of c.check) expect(at).toBeGreaterThan(Math.max(...c.teach));
          }
        });

        test("callouts name a misconception or a key idea's example and sit on teaching slides", () => {
          for (const [position, callout] of Object.entries(result.callouts)) {
            const entry = skeleton.outline[Number(position)];
            expect(["content", "worked-example"]).toContain(entry?.kind ?? "");
            expect(callout.text.length).toBeGreaterThan(0);
            if (callout.kind === "watch-out") {
              expect(callout.text).toBe(facts.misconceptions[callout.ref.index]?.belief ?? "");
            }
          }
        });
      });
    }
  }

  test("a watch-out callout is placed for every misconception the outline has room for", () => {
    const { input, facts } = inputFor(romans, 12);
    const watchOuts = Object.values(outlineFromFacts(input).callouts).filter(
      (c) => c.kind === "watch-out",
    );
    expect(watchOuts.length).toBe(Math.min(facts.misconceptions.length, 3));
    expect(new Set(watchOuts.map((c) => c.ref.index)).size).toBe(watchOuts.length);
  });
});
