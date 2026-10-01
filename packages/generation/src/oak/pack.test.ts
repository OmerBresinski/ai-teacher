import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LessonSchema } from "@tj/domain/documents";
import { planLessonPrompt } from "../prompts/plan-lesson";
import {
  adjacentKeyStage,
  approxTokens,
  buildOakPack,
  fitOakPack,
  type KeyStage,
  keyStageForYear,
  matchOakLessons,
  OAK_LICENCE_URL,
  type OakPack,
  type OakSearchHit,
  type OakSource,
  type OakSummary,
  oakCredits,
  oakPackFor,
  oakPacksOn,
  oakQueries,
  oakSubject,
  PACK_TOKENS,
  renderOakPack,
  textExitItems,
} from "./pack";

/* Synthetic Oak shapes (made-up text; no Oak content is committed). */
const summary = (title: string, extra: Partial<OakSummary> = {}): OakSummary => ({
  lessonTitle: title,
  canonicalUrl: `https://example.org/${title}`,
  subjectSlug: "geography",
  subjectTitle: "Geography",
  keyStageSlug: "ks2",
  lessonKeywords: Array.from({ length: 8 }, (_, i) => ({
    keyword: `term${i}`,
    description: `def ${i}`,
  })),
  keyLearningPoints: Array.from({ length: 7 }, (_, i) => ({ keyLearningPoint: `point ${i}.` })),
  misconceptionsAndCommonMistakes: [
    { misconception: "Wrong one.", response: "Right one." },
    { misconception: "Wrong two.", response: "Right two." },
    { misconception: "Wrong three.", response: "Right three." },
  ],
  ...extra,
});

const mc = (question: string, extra: Record<string, unknown> = {}) => ({
  question,
  questionType: "multiple-choice",
  answers: [
    { type: "text", content: "yes", distractor: false },
    { type: "text", content: "no", distractor: true },
  ],
  ...extra,
});

const fake = (o: {
  hits?: Record<string, OakSearchHit[]>;
  summaries?: Record<string, OakSummary>;
  status?: Record<string, string>;
  exit?: unknown[];
}): OakSource => ({
  search: (q, ks, subject) => o.hits?.[`${ks}|${subject}|${q}`] ?? [],
  summary: (slug) => o.summaries?.[slug] ?? null,
  quiz: () => ({ exitQuiz: (o.exit ?? []) as never }),
  restricted: (slug) => o.status?.[slug] ?? null,
});

describe("key stage, subject and queries", () => {
  test("the year gives the key stage; Reception and sixth form give none", () => {
    expect(
      ["Year 1", "Year 2", "Year 3", "Year 6", "Year 7", "Year 9", "Year 10", "Year 11"].map(
        keyStageForYear,
      ),
    ).toEqual(["ks1", "ks1", "ks2", "ks2", "ks3", "ks3", "ks4", "ks4"]);
    expect(keyStageForYear("Reception")).toBeNull();
    expect(keyStageForYear("Year 13")).toBeNull();
    expect((["ks1", "ks2", "ks3", "ks4"] as KeyStage[]).map(adjacentKeyStage)).toEqual([
      "ks2",
      "ks3",
      "ks4",
      "ks3",
    ]);
  });
  test("subjects map to Oak's enum; one Oak lacks maps to none", () => {
    expect(oakSubject("Maths")).toBe("maths");
    expect(oakSubject("Chemistry")).toBe("science");
    expect(oakSubject("RE")).toBe("religious-education");
    expect(oakSubject("Psychology")).toBeNull();
  });
  test("the title query is the part before the colon; the core term the longest new word after it", () => {
    expect(oakQueries("Rivers: the journey of a river from source to mouth")).toEqual({
      title: "rivers",
      core: "journey",
    });
    expect(oakQueries("Weimar Germany: the hyperinflation crisis of 1923")).toEqual({
      title: "weimar germany",
      core: "hyperinflation",
    });
    expect(oakQueries("Photosynthesis").core).toBeNull();
  });
  test("the flag is OAK_PACKS=1 and nothing else", () => {
    expect(oakPacksOn({ OAK_PACKS: "1" })).toBe(true);
    expect(oakPacksOn({ OAK_PACKS: "true" })).toBe(false);
    expect(oakPacksOn({})).toBe(false);
  });
});

describe("matcher (synthetic)", () => {
  const brief = {
    topic: "Rivers: the journey of a river",
    subject: "Geography",
    yearGroup: "Year 5",
  };
  test("ranks by shared topic words before similarity; a second lesson only when it shares as many", () => {
    const src = fake({
      hits: {
        "ks2|geography|rivers": [
          { lessonSlug: "flooding-rivers", lessonTitle: "Flooding rivers", similarity: 0.44 },
          { lessonSlug: "a-rivers-journey", lessonTitle: "A river's journey", similarity: 0.22 },
          { lessonSlug: "noise", lessonTitle: "Something else", similarity: 0.12 },
        ],
      },
    });
    const m = matchOakLessons(brief, src);
    expect(m.map((x) => [x.slug, x.match])).toEqual([["a-rivers-journey", "title"]]);
  });
  test("a hit from the core term is marked core; weak hits need a shared word", () => {
    const src = fake({
      hits: {
        "ks2|geography|journey": [
          { lessonSlug: "journeys", lessonTitle: "River journeys", similarity: 0.11 },
          { lessonSlug: "weak", lessonTitle: "Mountains", similarity: 0.14 },
        ],
      },
    });
    expect(matchOakLessons(brief, src).map((x) => [x.slug, x.match])).toEqual([
      ["journeys", "core"],
    ]);
  });
  test("one shared word in a long title is noise, however similar", () => {
    const src = fake({
      hits: {
        "ks3|history|weimar germany": [
          {
            lessonSlug: "empress",
            lessonTitle: "The early life of an empress of Germany",
            similarity: 0.17,
          },
        ],
      },
    });
    const weimar = { topic: "Weimar Germany: a crisis", subject: "History", yearGroup: "Year 9" };
    expect(matchOakLessons(weimar, src)).toEqual([]);
  });
  test("no match in the key stage falls back to the adjacent one; nothing anywhere gives no pack", () => {
    const hit = { lessonSlug: "older", lessonTitle: "River journeys", similarity: 0.3 };
    const src = fake({
      hits: { "ks3|geography|rivers": [hit] },
      summaries: { older: summary("River journeys") },
      exit: [mc("Is it?")],
    });
    const m = matchOakLessons(brief, src);
    expect(m.map((x) => x.match)).toEqual(["adjacent-ks"]);
    const pack = buildOakPack(m, { ...src, restricted: () => "ogl-compatible" });
    expect(pack?.keywords).toEqual([]);
    expect(pack?.exitItems).toEqual([]);
    expect(pack?.keyPoints.length).toBe(5);
    expect(matchOakLessons(brief, fake({}))).toEqual([]);
    expect(buildOakPack([], src)).toBeNull();
  });
});

describe("pack builder (synthetic)", () => {
  const m = [
    {
      slug: "l",
      title: "L",
      similarity: 0.5,
      overlap: 1,
      match: "title" as const,
      keyStage: "ks2" as const,
    },
  ];
  test("caps: 6 keywords, 5 key points, 2 misconceptions, 4 exit items", () => {
    const src = fake({
      summaries: { l: summary("L") },
      status: { l: "ogl-compatible" },
      exit: Array.from({ length: 6 }, (_, i) => mc(`Q${i}?`)),
    });
    const p = buildOakPack(m, src);
    expect([
      p?.keywords.length,
      p?.keyPoints.length,
      p?.misconceptions.length,
      p?.exitItems.length,
    ]).toEqual([6, 5, 2, 4]);
    expect(p?.lessons[0]?.licence).toBe("ogl");
  });
  test("a restricted or unchecked lesson gives summary fields only", () => {
    for (const status of [{ l: "restricted" }, {}] as Record<string, string>[]) {
      const p = buildOakPack(m, fake({ summaries: { l: summary("L") }, status, exit: [mc("Q?")] }));
      expect(p?.exitItems).toEqual([]);
      expect(p?.lessons[0]?.licence).toBe("restricted");
      expect(p?.keywords.length).toBe(6);
    }
  });
  test("exit items are text only: pictures, match and order questions are dropped; short answers keep one answer", () => {
    const items = textExitItems({
      exitQuiz: [
        mc("Which is shown in this image?"),
        mc("Pick one", { questionImage: { url: "x" } }),
        { question: "Match them", questionType: "match", answers: {} },
        { question: "Order them", questionType: "order", answers: [] },
        mc("Pick", { answers: [{ type: "image", content: {} }] }),
        {
          question: "The point is a {{}} temperature.",
          questionType: "short-answer",
          answers: [
            { type: "text", content: "fixed" },
            { type: "text", content: "Fixed" },
          ],
        },
        mc("Plain?"),
      ] as never,
    });
    expect(items).toEqual([
      { q: "The point is a ___ temperature.", right: ["fixed"], wrong: [] },
      { q: "Plain?", right: ["yes"], wrong: ["no"] },
    ]);
  });
  test("the reference block: plain lines, the use line, no question-style line without items", () => {
    const p = buildOakPack(
      m,
      fake({ summaries: { l: summary("L") }, status: { l: "ogl-compatible" }, exit: [mc("Q?")] }),
    );
    const text = renderOakPack(p as never, "Year 5");
    expect(text).toContain("- term0: def 0");
    expect(text).toContain("- Where pupils go wrong: Wrong one. What helps: Right one.");
    expect(text).toContain("- Q? Right: yes. Wrong: no.");
    expect(text).toContain("never copy its sentences or questions");
    expect(text).toContain("in the style of its questions");
    expect(text).not.toMatch(/misconception:|objectives?:/i);
    const bare = renderOakPack({ ...(p as OakPack), exitItems: [] }, "Year 5");
    expect(bare).not.toContain("in the style of its questions");
  });
  test("credits: the OGL statement with the subject, the v3 link, valid on the lesson schema", () => {
    const p = buildOakPack(m, fake({ summaries: { l: summary("L") } }));
    const credits = oakCredits(p as never);
    expect(credits[0]?.text).toBe(
      "A Geography lesson by Oak National Academy licensed under Open Government Licence (OGL)",
    );
    expect(credits[0]?.licenceUrl).toBe(OAK_LICENCE_URL);
    const lesson = {
      version: 1,
      id: "x",
      title: "t",
      themeId: "chalk",
      slides: [],
      updatedAt: "now",
      contentCredits: credits,
    };
    expect(LessonSchema.parse(lesson).contentCredits).toEqual(credits);
  });
  test("flag off, or no brief: no pack", () => {
    const lesson = { subject: "Geography", yearGroup: "Year 5", brief: { topic: "Rivers" } };
    const src = fake({
      hits: {
        "ks2|geography|rivers": [{ lessonSlug: "l", lessonTitle: "Rivers", similarity: 0.5 }],
      },
      summaries: { l: summary("L") },
    });
    expect(oakPackFor(lesson, src, {})).toBeNull();
    expect(oakPackFor({ ...lesson, brief: undefined }, src, { OAK_PACKS: "1" })).toBeNull();
    expect(oakPackFor(lesson, src, { OAK_PACKS: "1" })?.credits.length).toBe(1);
  });
});

describe("planner prompt (plan-lesson.v22)", () => {
  const input = {
    topic: "Rivers",
    audience: { yearGroup: "Year 5" } as never,
    slideCount: 8,
    menu: [],
  };
  test("the reference sits before the Slides line; without one the user turn has no trace of it", () => {
    const withRef = planLessonPrompt({ ...input, reference: "Reference: X" }).user;
    expect(withRef.indexOf("Reference: X")).toBeLessThan(withRef.indexOf("Slides: 8."));
    expect(planLessonPrompt(input).user).not.toContain("Reference");
    expect(planLessonPrompt({ ...input, reference: "  " }).user).toBe(planLessonPrompt(input).user);
  });
});

/*
 * The probe's cached raw JSON (outside the repo, never committed): skipped when absent. Its search
 * files were saved under the probe's own queries; a query here reads the file whose probe query's
 * words it holds (by the same four-letter stem the matcher uses).
 */
const RAW = process.env.OAK_RAW_DIR ?? join(import.meta.dir, "../../../../../quality-prd/oak/raw");
const haveRaw = existsSync(join(RAW, "check-restricted.json"));
const PROBE: [KeyStage, string, string, string][] = [
  ["ks2", "maths", "ratio", "s-ratio-ks2"],
  ["ks2", "geography", "rivers", "s-rivers-ks2"],
  ["ks3", "geography", "river flooding", "s-rivers-ks3"],
  ["ks3", "history", "weimar", "s-weimar-ks3"],
  ["ks4", "history", "hyperinflation", "s-hyper-ks4"],
  ["ks3", "science", "particle model", "s-particle-ks3"],
];
const stems = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((w) => w.slice(0, 4));
const readRaw = (f: string) =>
  existsSync(join(RAW, f)) ? JSON.parse(readFileSync(join(RAW, f), "utf8")) : null;
const rawSource: OakSource = {
  search: (q, ks, subject) => {
    const have = new Set(stems(q));
    const hit = PROBE.find(
      ([k, s, pq]) => k === ks && s === subject && stems(pq).every((w) => have.has(w)),
    );
    return hit ? readRaw(`${hit[3]}.json`) : [];
  },
  summary: (slug) => readRaw(`${slug}.summary.json`),
  quiz: (slug) => {
    const q = readRaw(`${slug}.quiz.json`);
    return q && Array.isArray(q.exitQuiz) ? q : null;
  },
  restricted: (slug) => readRaw("check-restricted.json")?.[slug] ?? null,
};

describe.skipIf(!haveRaw)("matcher and pack on the probe's cached raw JSON", () => {
  const pack = (topic: string, subject: string, yearGroup: string) => {
    const m = matchOakLessons({ topic, subject, yearGroup }, rawSource);
    return { m, p: buildOakPack(m, rawSource) };
  };
  test("y6-ratio: solve-problems-involving-ratio by title, OGL, text exit items", () => {
    const { m, p } = pack(
      "Ratio: solving problems involving the relative sizes of two quantities",
      "Maths",
      "Year 6",
    );
    expect(m[0]?.slug).toBe("solve-problems-involving-ratio");
    expect(m[0]?.match).toBe("title");
    expect(p?.lessons.map((l) => l.licence)).toEqual(["ogl"]);
    expect(p?.exitItems.length).toBeGreaterThan(0);
    expect(p?.exitItems.length).toBeLessThanOrEqual(4);
    expect(p?.misconceptions.length).toBeGreaterThan(0);
  });
  test("y5-rivers: the river's journey (not the higher-similarity flooding lesson), its source-speed misconception", () => {
    const { m, p } = pack(
      "Rivers: the journey of a river from source to mouth",
      "Geography",
      "Year 5",
    );
    expect(m.map((x) => x.slug)).toEqual(["the-rivers-journey"]);
    expect(p?.misconceptions[0]?.wrong).toMatch(/source/i);
    for (const e of p?.exitItems ?? []) expect(e.q).not.toMatch(/image|match/i);
  });
  test("y9-weimar: no KS3 lesson, the KS4 hyperinflation lesson as adjacent-ks, points and misconceptions only", () => {
    const { m, p } = pack("Weimar Germany: the hyperinflation crisis of 1923", "History", "Year 9");
    expect(m.map((x) => [x.slug, x.match])).toEqual([
      ["1923-the-ruhr-and-hyperinflation", "adjacent-ks"],
    ]);
    expect(p?.keywords).toEqual([]);
    expect(p?.exitItems).toEqual([]);
    expect(p?.keyPoints.length).toBeGreaterThan(0);
  });
  test("a restricted match (KS3 rivers and flooding) gives summary fields and no exit items", () => {
    const { m, p } = pack("River flooding: causes and effects", "Geography", "Year 8");
    expect(m[0]?.slug).toBe("the-causes-of-flooding");
    expect(p?.lessons[0]?.licence).toBe("restricted");
    expect(p?.exitItems).toEqual([]);
    expect(p?.keywords.length).toBeGreaterThan(0);
  });
  test("a repeated problem is kept once; equations lose their LaTeX", () => {
    const items = textExitItems(rawSource.quiz("solve-problems-involving-ratio"), 6);
    expect(items.map((e) => e.right.join()).join(" ")).not.toContain("$$");
    const firsts = items.map((e) => e.q.slice(0, 20));
    expect(new Set(firsts).size).toBe(firsts.length);
  });
  test("every pack fits about 450 tokens, misconceptions whole", () => {
    for (const [t, s, y] of [
      ["Ratio: solving problems involving the relative sizes of two quantities", "Maths", "Year 6"],
      ["Rivers: the journey of a river from source to mouth", "Geography", "Year 5"],
      ["Weimar Germany: the hyperinflation crisis of 1923", "History", "Year 9"],
    ] as const) {
      const { p } = pack(t, s, y);
      const fitted = fitOakPack(p as OakPack, y);
      expect(approxTokens(renderOakPack(fitted, y))).toBeLessThanOrEqual(PACK_TOKENS);
      expect(fitted.misconceptions).toEqual((p as OakPack).misconceptions);
    }
  });
});
