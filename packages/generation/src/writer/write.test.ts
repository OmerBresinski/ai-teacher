import { describe, expect, test } from "bun:test";
import { createFakeAi, type FakeCall } from "@tj/ai/testing";
import type { Lesson } from "@tj/domain/documents";
import { svgOfDataUrl } from "@tj/slides/diagram-builds";
import { PLACEHOLDER_IMAGE } from "@tj/slides/layouts";
import { WRITER_WORDS } from "../library/catalogue";
import { WRITER_PLANNED_VERSION } from "../stages/objectives-first";
import { write } from "../stages/write";
import {
  callLimitedBudget,
  initialState,
  recordingDeps,
  sampleBriefLesson,
  writerFixture,
} from "../testing";
import { StageFailure } from "../types";
import { aiWriterServices, WRITER_VERSION, writerRoute } from "./ai-services";
import { writerBundle } from "./bundle";
import { writerIncomplete } from "./fixes";
import { recordedVisuals, replayRun, replayServices } from "./replay-fixture";
import { isFatal, WRITER_MAX_TOKENS, writerMaxTokens } from "./services";
import { WriterIncompleteError } from "./stage";

/*
 * The writer stage's stops (TEACH-110 part b review): a cancel or a budget stop is never
 * swallowed into a degraded "Lesson ready" deck; K3 saves no deck, keeps the call's cost, and a
 * `length` finish is not retried; the repair, restage and fallback order.
 */

const fixture = writerFixture();
const planned = (): Lesson =>
  ({
    ...sampleBriefLesson(),
    ageBand: "ks2",
    facts: {
      ...(sampleBriefLesson().facts ?? {}),
      objectives: [
        { id: "o1", text: "Find unit fractions of amounts" },
        { id: "o2", text: "Find non-unit fractions of amounts" },
      ],
    },
    generation: {
      jobId: "j1",
      stage: "planned",
      startedAt: "2026-10-08T10:00:00.000Z",
      promptVersions: { planned: WRITER_PLANNED_VERSION },
      findings: [],
    },
  }) as unknown as Lesson;
const abortError = () => new DOMException("cancelled", "AbortError");
/** A fake answering the writer's calls by prompt version; `on` may override one. */
const fakeAi = (on: (name: string, call: FakeCall) => string | undefined = () => undefined) =>
  createFakeAi({
    route: writerRoute,
    fallback: async (call) => {
      const name = (call.context?.promptVersion ?? "").slice(`${WRITER_VERSION}/`.length);
      if (call.abortSignal?.aborted) throw abortError();
      const own = on(name, call);
      if (own !== undefined) return own;
      if (name === "lesson") return fixture.main;
      if (name === "notes") return fixture.notes;
      return "{}";
    },
  });

describe("a stop is never swallowed", () => {
  test("a cancel after the editable save: the stage rejects, no deck is saved as ready", async () => {
    const deps = recordingDeps(fakeAi(), { abortAfterPersist: 1 });
    const err = await write(initialState(planned()), deps).catch((e: unknown) => e);
    expect(isFatal(err)).toBe(true);
    expect(deps.persisted.map((p) => p.lesson.generation?.stage)).toEqual(["planned"]);
    expect(deps.progress.some((p) => p.message === "Lesson ready")).toBe(false);
  });

  test("a cancel during the writer call saves nothing at all", async () => {
    const deps = recordingDeps(
      fakeAi((name) => {
        if (name === "lesson") throw abortError();
        return undefined;
      }),
    );
    const err = await write(initialState(planned()), deps).catch((e: unknown) => e);
    expect(isFatal(err)).toBe(true);
    expect(deps.persisted).toHaveLength(0);
  });

  test("a budget stop in the notes call rejects instead of shipping empty notes", async () => {
    // The budget lets the writer and the pupil-wording call through, then refuses.
    const deps = recordingDeps(fakeAi(), { budget: callLimitedBudget(2) });
    const err = await write(initialState(planned()), deps).catch((e: unknown) => e);
    expect(isFatal(err)).toBe(true);
    expect(deps.persisted.some((p) => p.lesson.generation?.stage === "generated")).toBe(false);
  });

  test("a provider error stays non-fatal: the deck still finishes", async () => {
    const deps = recordingDeps(
      fakeAi((name) => {
        if (name === "pupil_objectives") throw new Error("provider 500");
        return undefined;
      }),
    );
    const out = await write(initialState(planned()), deps);
    expect(out.lesson.generation?.stage).toBe("generated");
    // TEACH-251: with no image placer every picture slot fails, so its slide is restaged
    // text-only (one overflowed into a continuation slide) and no placeholder ships.
    expect(out.lesson.slides.filter((sl) => !/c\d+$/.test(sl.id)).length).toBe(12);
    const srcs = out.lesson.slides.flatMap((sl) =>
      sl.elements.flatMap((e) => (e.type === "image" ? [e.src] : [])),
    );
    expect(srcs).not.toContain(PLACEHOLDER_IMAGE);
  });

  test("a call's own deadline aborts it as a non-fatal timeout", async () => {
    const ai = createFakeAi({
      route: writerRoute,
      fallback: (call) =>
        new Promise((_, reject) =>
          call.abortSignal?.addEventListener("abort", () => reject(call.abortSignal?.reason)),
        ),
    });
    const services = aiWriterServices(recordingDeps(ai));
    const err = await services
      .chat({
        model: "x",
        system: "s",
        user: "u",
        schema: { type: "object" },
        name: "notes",
        timeoutMs: 20,
      })
      .catch((e: unknown) => e);
    expect(((err as Error).cause as Error | undefined)?.name).toBe("TimeoutError");
    expect(isFatal(err)).toBe(false);
  });
});

describe("K3 in the stage", () => {
  test("an incomplete output saves no deck, keeps the call's cost, and is retryable", async () => {
    const deps = recordingDeps(fakeAi((name) => (name === "lesson" ? '{"flow": [' : undefined)));
    const err = await write(initialState(planned()), deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StageFailure);
    expect((err as StageFailure).reason).toBeUndefined();
    expect(deps.persisted).toHaveLength(1);
    const saved = deps.persisted[0]?.lesson;
    expect(saved?.slides).toEqual(planned().slides);
    expect(saved?.generation?.stage).toBe("planned");
    expect(saved?.generation?.usage).toEqual(deps.budget.totals());
  });
  test("a length finish is deterministic: the worker does not retry it", () => {
    expect(new WriterIncompleteError("finish_reason length (token limit)").deterministic).toBe(
      true,
    );
    expect(new WriterIncompleteError("writer JSON does not parse").deterministic).toBe(false);
  });
  test("content-filter and error finishes are incomplete too", () => {
    expect(writerIncomplete({ text: "{}", finishReason: "content-filter", minSlides: 9 })).toBe(
      "finish_reason content-filter",
    );
    expect(writerIncomplete({ text: "{}", finishReason: "error", minSlides: 9 })).toBe(
      "finish_reason error",
    );
  });
  test("the token cap scales with the slide range; Standard keeps the pinned 9,000", () => {
    expect(writerMaxTokens(8)).toBe(WRITER_MAX_TOKENS);
    expect(writerMaxTokens(12)).toBe(WRITER_MAX_TOKENS);
    expect(writerMaxTokens(20)).toBe(14790);
  });
  test("the writer route needs the version's slash", () => {
    expect(
      writerRoute("frontier", { stage: "write", promptVersion: `${WRITER_VERSION}x/lesson` }),
    ).toBeUndefined();
  });
});

describe("repair, restage and fallback order (FOR-CODE item 5)", () => {
  test("a missing picture goes straight to restage, and a restaged slide never goes back to repair", async () => {
    const b = "y8-french-my-family";
    const calls: { name: string; system: string }[] = [];
    const base = replayServices(b);
    const services = {
      ...base,
      chat: async (r: Parameters<typeof base.chat>[0]) => {
        calls.push({
          name: r.name,
          system:
            r.system === writerBundle().restage
              ? "restage"
              : r.system === writerBundle().repair
                ? "repair"
                : "other",
        });
        return base.chat(r);
      },
    };
    const seen = recordedVisuals(b);
    // Slide 5's picture (index 4) is lost: no source found.
    const out = await replayRun(b, {
      services,
      visual: (i, key, a) =>
        i === 4 && key === "picture" ? { status: "failed" } : seen(i, key, a),
    });
    const restageAt = calls.findIndex((c) => c.system === "restage");
    expect(restageAt).toBeGreaterThanOrEqual(0);
    // Every fit repair runs before the restage, none after it.
    expect(calls.slice(restageAt + 1).some((c) => c.system === "repair")).toBe(false);
    // The picture is gone from the slide (fixed fallback: figure dropped).
    expect((out.slides[4]?.elements ?? []).some((e) => e.name === "Photo")).toBe(false);
  });
});

describe("the diagram library is on for the writer (TEACH-247 part m)", () => {
  test("the writer's compiled request offers the filtered library menu", async () => {
    const ai = fakeAi();
    const out = await write(initialState(planned()), recordingDeps(ai));
    expect(out.lesson.generation?.stage).toBe("generated");
    const lesson = ai.calls.filter((c) => c.context?.promptVersion === `${WRITER_VERSION}/lesson`);
    expect(lesson).toHaveLength(1);
    const system = lesson[0]?.systemText ?? "";
    expect(system).toContain("Diagram kinds:");
    expect(system).toContain(WRITER_WORDS.menuLine);
    expect(system).toContain(WRITER_WORDS.header);
  });
});

describe("the library through the production write stage (PR #450 review)", () => {
  // The fixture's first slide (deck slide 3) asks the library for a model instead of a drawer spec.
  const drawerFigure = (JSON.parse(fixture.main) as { slides: Record<string, unknown>[] }).slides[0]
    ?.figure;
  const withModel = (): string => {
    const out = JSON.parse(fixture.main) as { slides: Record<string, unknown>[] };
    out.slides[0] = {
      template: "big-visual",
      heading: "Find ¼ of 24",
      lead: "Share 24 counters into four equal groups.",
      figure: {
        kind: "model",
        model: "equal_groups",
        intent: "24 counters shared into four equal groups of six.",
        alt: "Four equal groups each contain six counters.",
      },
    };
    return JSON.stringify(out);
  };
  const isFill = (call: FakeCall) => (call.systemText ?? "").startsWith("Set the parameters");
  /** The fake with the model ask; `fill` answers the fill (and repair) calls. */
  const libraryAi = (fill: () => string) =>
    fakeAi((name, call) => {
      if (name === "lesson") return withModel();
      if (name !== "diagram") return undefined;
      if (isFill(call)) return fill();
      const { shows: _shows, ...spec } = drawerFigure as Record<string, unknown>;
      return JSON.stringify(spec);
    });
  const diagramOf = (lesson: Lesson) => {
    const els = (lesson.slides[2]?.elements ?? []) as unknown as Record<string, unknown>[];
    return els.find((e) => e.name === "Diagram");
  };
  /** The library's drawings carry the kit's slide class; the drawer's never do. */
  const librarySvg = (src: unknown) =>
    (svgOfDataUrl(String(src ?? "")) ?? "").includes('class="slide tk theme-primary"');

  test("a model the writer picks is filled by the fill call and drawn", async () => {
    const ai = libraryAi(() => JSON.stringify({ groups: 4, size: 6, division: "sharing" }));
    const out = await write(initialState(planned()), recordingDeps(ai));
    expect(out.lesson.generation?.stage).toBe("generated");
    const fills = ai.calls.filter(isFill);
    expect(fills).toHaveLength(1);
    expect(fills[0]?.promptText).toContain("Intent: 24 counters shared into four equal groups");
    // Drawn by the library, so the drawer never runs for it.
    expect(
      ai.calls.filter((c) => c.context?.promptVersion?.endsWith("/diagram") && !isFill(c)),
    ).toHaveLength(0);
    expect(librarySvg(diagramOf(out.lesson)?.src)).toBe(true);
  }, 60_000);

  for (const [what, fill] of [
    ["invalid params", () => JSON.stringify({ groups: "many" })],
    [
      "a failed fill call",
      () => {
        throw new Error("provider 500");
      },
    ],
  ] as const) {
    test(`${what}: the slide falls back to the drawer and the lesson is generated`, async () => {
      const ai = libraryAi(fill);
      const out = await write(initialState(planned()), recordingDeps(ai));
      expect(out.lesson.generation?.stage).toBe("generated");
      expect(ai.calls.filter(isFill).length).toBeGreaterThanOrEqual(1);
      const drawer = ai.calls.filter(
        (c) => c.context?.promptVersion?.endsWith("/diagram") && !isFill(c),
      );
      expect(drawer.length).toBeGreaterThanOrEqual(1);
      expect(drawer[0]?.promptText).toContain("Kind: equal-groups");
      const diagram = diagramOf(out.lesson);
      expect(diagram).toBeDefined();
      expect(svgOfDataUrl(String(diagram?.src)) ?? "").toContain("<svg");
      expect(librarySvg(diagram?.src)).toBe(false);
    }, 60_000);
  }
});
