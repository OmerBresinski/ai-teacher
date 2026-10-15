import { describe, expect, test } from "bun:test";
import { type Slide, type SlideElement, TEACHER_ONLY_MARK } from "@tj/domain/documents";
import { contrastRatio } from "../look";
import { THEMES } from "../themes";
import { surfacesOf } from "../themes/surfaces";
import {
  ANSWER_TYPE,
  type AnswerGroup,
  answerColumns,
  answerGroupsOf,
  answerItem,
  answersSize,
  endAnswerSlides,
  layoutAnswersGuard,
  layoutAnswersPage,
  paginateAnswers,
  projected,
} from "./end-answers";
import { measureAnswersCapacity } from "./end-answers-capacity";
import capacity from "./end-answers-capacity.json";
import CASES from "./fixtures/end-answers-cases.json";
import { layoutTemplate, type Stage } from "./index";

/*
 * TEACH-191 part b (UX rulings 190, 193, 201, 231, 240): the end-of-deck Answers slides and their
 * guard, against the gold `ROOT/northstars-v13/answers/NOTES.md` (r1 ledger C, r2 multi-slide,
 * r3 guard). The gold cases are `fixtures/end-answers-cases.json` (`cases-r2.js`, numbered).
 */
type Case = { stage: Stage; groups: AnswerGroup[] };
const cases = CASES as unknown as Record<string, Case>;
const paper = THEMES.find((t) => t.id === "paper") ?? (THEMES[0] as (typeof THEMES)[number]);
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];

/** A page as "4 / 2+4 / 3": each slide's groups by their answer counts. */
const shape = (c: Case, t = paper) =>
  paginateAnswers(t, c.stage, c.groups)
    .map((p) => p.groups.map((g) => g.items.length).join("+"))
    .join(" / ");
const texts = (s: Slide) =>
  s.elements.flatMap((e) =>
    e.type === "text" || (e.type === "shape" && e.doc) ? [{ e, words: wordsOf(e) }] : [],
  );
const wordsOf = (e: SlideElement): string => {
  const walk = (n: unknown): string =>
    !n || typeof n !== "object"
      ? ""
      : "text" in n && typeof n.text === "string"
        ? n.text
        : "content" in n && Array.isArray(n.content)
          ? n.content.map(walk).join("")
          : "";
  return walk("doc" in e ? e.doc : undefined);
};
const sizeOf = (e: SlideElement) =>
  e.type === "text" ? e.style.fontSize : e.type === "shape" ? e.textStyle?.fontSize : undefined;

describe("pagination (gold r2: whole groups first, never one answer alone, no slide cap)", () => {
  test("a typical practice + exit pair is one slide at KS1 and KS2", () => {
    expect(shape(cases.ks1 as Case)).toBe("3+2");
    expect(shape(cases.ks2 as Case)).toBe("6+3");
  });

  test("KS3 sentence answers split at the group boundary (4 + 3 -> 4 / 3)", () => {
    expect(shape(cases.ks3 as Case)).toBe("4 / 3");
  });

  test("the 3-slide KS3 case splits 4 / 2 + 4 / 3, numbers carry on and the heading repeats", () => {
    const c = cases.three as Case;
    for (const t of THEMES) expect(shape(c, t)).toBe("4 / 2+4 / 3");
    const pages = paginateAnswers(paper, c.stage, c.groups);
    expect(pages.map((p) => p.of)).toEqual([3, 3, 3]);
    const carried = pages[1]?.groups[0];
    expect(carried?.title).toBe(c.groups[0]?.title);
    expect(carried?.items.map((it) => it.n)).toEqual([5, 6]);
    const titles = pages.map((p) =>
      wordsOf(layoutAnswersPage(p, paper, c.stage).slide.elements[0] as SlideElement),
    );
    expect(titles).toEqual(["Answers (1 of 3)", "Answers (2 of 3)", "Answers (3 of 3)"]);
  });

  test("a group too long for one slide splits inside itself (KS3 6 sentences -> 4 / 2 + 3)", () => {
    expect(shape(cases.over3 as Case)).toBe("4 / 2+3");
  });

  test("a single slide is titled just Answers", () => {
    const [page] = paginateAnswers(paper, "ks2", (cases.ks2 as Case).groups);
    const slide = layoutAnswersPage(page as never, paper, "ks2").slide;
    expect(wordsOf(slide.elements[0] as SlideElement)).toBe("Answers");
  });

  test("no slide or carried part ever holds one answer alone when its group has more", () => {
    for (const stage of STAGES)
      for (let n = 2; n <= 30; n++) {
        const groups: AnswerGroup[] = [
          {
            kind: "practice",
            title: "Long practice",
            items: seq(n, (i) => answerItem(i, SENTENCE)),
          },
          { kind: "exit", title: "Exit", items: seq(3, (i) => answerItem(i, "Belgium")) },
        ];
        for (const p of paginateAnswers(paper, stage, groups))
          for (const g of p.groups) {
            const whole = groups.find((w) => w.title === g.title) as AnswerGroup;
            if (whole.items.length > 1) expect(g.items.length).toBeGreaterThan(1);
          }
      }
  });
});

const SENTENCE =
  "Germany invaded France through Belgium, and Britain had promised to protect Belgium.";
const seq = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i + 1));

describe("fit: type from the age ceiling, never under comfort; nothing over", () => {
  for (const [name, c] of Object.entries(cases))
    test(`${name}: every page fits on every theme, at comfort or above, 60-100% full or at the ceiling`, () => {
      for (const t of THEMES)
        for (const p of paginateAnswers(t, c.stage, c.groups)) {
          const r = layoutAnswersPage(p, t, c.stage);
          expect(r.over).toEqual([]);
          expect(r.size).toBeLessThanOrEqual(ANSWER_TYPE[c.stage].top);
          expect(r.size).toBeGreaterThanOrEqual(ANSWER_TYPE[c.stage].comfort);
          expect(r.fill).toBeLessThanOrEqual(1);
          // Short content grows: up to the ceiling, then the gaps spread toward ~75% full.
          if (r.size < ANSWER_TYPE[c.stage].top) expect(r.fill).toBeGreaterThan(0.6);
          else expect(r.fill).toBeGreaterThan(0.45);
        }
    });

  test("the capacity table is the renderer's (renderer = table)", () => {
    expect(measureAnswersCapacity()).toEqual(capacity);
  });

  test("a group at its cap fits one slide; one more answer needs a second slide", () => {
    const kinds: Record<string, (n: number) => AnswerGroup["items"][number]> = {
      numbers: (n) => ({ n, a: "6,245" }),
      "20-word sentences": (n) => ({
        n,
        s: "Russia mobilised to defend Serbia, so Germany declared war on Russia and then on France, its ally, that same week.",
      }),
    };
    for (const stage of STAGES)
      for (const [kind, item] of Object.entries(kinds)) {
        const cap = (capacity as Record<string, Record<string, number>>)[stage]?.[kind] ?? 0;
        const g = (n: number): AnswerGroup[] => [
          { kind: "practice", title: "Causes", items: seq(n, item) },
        ];
        for (const t of THEMES) expect(answersSize(t, stage, g(cap))).toBeDefined();
        expect(THEMES.some((t) => answersSize(t, stage, g(cap + 1)) === undefined)).toBe(true);
      }
  });

  test("stored sizes: answers and lines at or over the body floor (20); labels over the caption floor", () => {
    const LABELS = new Set(["Kicker", "Verdict", "surface:badge", TEACHER_ONLY_MARK]);
    for (const t of THEMES)
      for (const c of Object.values(cases))
        for (const s of endAnswerSlides(c.groups, t, c.stage))
          for (const e of s.elements) {
            const size = sizeOf(e);
            if (size === undefined) continue;
            expect(size).toBeGreaterThanOrEqual(LABELS.has(e.name ?? "") ? 14 : 20);
          }
  });
});

describe("columns (gold: a rule, not a fit)", () => {
  test("KS1 '43 stickers' gives one column, not 2 + 1; six KS2 numbers go 3 x 2", () => {
    expect(answerColumns(paper, "ks1", (cases.ks1 as Case).groups[0]?.items ?? [])).toBe(1);
    expect(answerColumns(paper, "ks2", (cases.ks2 as Case).groups[0]?.items ?? [])).toBe(3);
  });
  test("worked answers, sentences and true/false with corrections are 1 per row", () => {
    expect(answerColumns(paper, "ks2", (cases.ks2 as Case).groups[1]?.items ?? [])).toBe(1);
    expect(answerColumns(paper, "ks3", (cases.ks3 as Case).groups[0]?.items ?? [])).toBe(1);
    expect(answerColumns(paper, "ks2", (cases.tf as Case).groups[0]?.items ?? [])).toBe(1);
  });
  test("bare true/false and 2-4 short answers sit on one row (2 x 2 when 4 do not fit)", () => {
    expect(
      answerColumns(
        paper,
        "ks2",
        seq(3, (n) => ({ n, tf: n % 2 === 0 })),
      ),
    ).toBe(3);
    expect(
      answerColumns(
        paper,
        "ks2",
        seq(4, (n) => ({ n, tf: n % 2 === 0 })),
      ),
    ).toBe(2);
    expect(
      answerColumns(
        paper,
        "ks3",
        seq(4, (n) => ({ n, a: "76" })),
      ),
    ).toBe(4);
    expect(answerColumns(paper, "ks2", (cases.tf as Case).groups[1]?.items ?? [])).toBe(2);
  });
});

describe("theme roles, no literal colours, AA", () => {
  test("every fill and colour is a theme or surface token, on every theme", () => {
    for (const t of THEMES) {
      const sf = surfacesOf(t);
      const tokens = new Set(
        [
          ...Object.values(t.colors).flat(),
          ...Object.values(sf.roles).flatMap((r) => [r.fill, r.ink, r.line]),
          ...Object.values(sf.states).flatMap((r) => [r?.fill, r?.ink, r?.line]),
          sf.ground,
        ]
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.slice(0, 7).toUpperCase()),
      );
      for (const c of Object.values(cases))
        for (const s of endAnswerSlides(c.groups, t, c.stage))
          for (const e of s.elements) {
            const paint = [
              "fill" in e ? e.fill : undefined,
              "color" in e ? e.color : undefined,
              e.type === "text" ? e.style.color : undefined,
              e.type === "shape" ? e.textStyle?.color : undefined,
            ].filter((v): v is string => typeof v === "string");
            for (const v of paint) expect(tokens.has(v.slice(0, 7).toUpperCase())).toBe(true);
          }
    }
  });

  test("painted parts carry their role: badge, verdict chips, chip:quiet pill, rule, field-b disc", () => {
    const [guard, page] = endAnswerSlides((cases.three as Case).groups, paper, "ks3")
      .slice(0, 3)
      .slice(1);
    const names = new Set(
      [...(guard?.elements ?? []), ...(page?.elements ?? [])].map((e) => e.name),
    );
    for (const n of [
      "surface:badge",
      "surface:verdict-right",
      "surface:verdict-wrong",
      "Rule",
      TEACHER_ONLY_MARK,
    ])
      expect(names.has(n)).toBe(true);
    const disc = layoutAnswersGuard(paper, "ks2").slide.elements[0];
    expect(disc?.name).toBe("Guard disc");
    expect(disc && disc.type === "shape" && disc.shape).toBe("ellipse");
    expect(disc && "fill" in disc && disc.fill).toBe(
      surfacesOf(paper).roles["field-b"].fill.slice(0, 7),
    );
  });

  test("answers read AA on the ground; badge and chip words read on their fills (large, bold)", () => {
    for (const t of THEMES) {
      const ground = surfacesOf(t).ground.slice(0, 7);
      for (const c of Object.values(cases))
        for (const s of endAnswerSlides(c.groups, t, c.stage).slice(1)) {
          const fills = s.elements.filter((e) => e.type === "shape");
          for (const e of s.elements) {
            if (
              e.type === "text" &&
              ["Answer", "Model answer", "Source title"].includes(e.name ?? "")
            )
              expect(contrastRatio(e.style.color as string, ground)).toBeGreaterThanOrEqual(4.5);
            if (e.type === "text" && e.name === "Verdict") {
              const under = fills.find(
                (f) => f.x <= e.x && f.x + f.w >= e.x && f.y <= e.y + 2 && f.y + f.h >= e.y,
              );
              expect(
                contrastRatio(e.style.color as string, (under as { fill: string }).fill),
              ).toBeGreaterThanOrEqual(3);
            }
            if (e.type === "shape" && e.name === "surface:badge")
              expect(
                contrastRatio(e.textStyle?.color as string, e.fill as string),
              ).toBeGreaterThanOrEqual(3);
          }
        }
    }
  });
});

describe("the guard (gold r3) and the teacher-only pill", () => {
  test("the guard reads only 'Answers on the next slide' and one line, never who it is for", () => {
    for (const t of THEMES)
      for (const stage of STAGES) {
        const r = layoutAnswersGuard(t, stage);
        expect(r.over).toEqual([]);
        expect(r.slide.answersRole).toBe("guard");
        const words = texts(r.slide).map((x) => x.words);
        expect(words).toEqual(["Answers on the next slide", "Get ready to check your work."]);
        expect(words.join(" ").toLowerCase()).not.toContain("teacher");
      }
  });

  test("the pill sits on every Answers slide and is never projected", () => {
    const slides = endAnswerSlides((cases.ks2 as Case).groups, paper, "ks2");
    expect(slides.map((s) => s.answersRole)).toEqual(["guard", "answers"]);
    const page = slides[1] as Slide;
    expect(page.elements.filter((e) => e.name === TEACHER_ONLY_MARK)).toHaveLength(3);
    expect(projected(page).elements.some((e) => e.name === TEACHER_ONLY_MARK)).toBe(false);
    expect(projected(slides[0] as Slide)).toBe(slides[0] as Slide);
  });
});

describe("the deck builder", () => {
  const deck = (): Slide[] =>
    [
      layoutTemplate(
        {
          template: "practice",
          heading: "Add using the column method",
          questions: ["2,345 + 3,900", "4,102 + 2,100", "5,000 + 4,221"],
          answers: ["6,245", "6,202", "9,221"],
        },
        paper,
        "ks2",
      ),
      layoutTemplate(
        { template: "explain", heading: "Carrying", lead: "Carry into the next column." },
        paper,
        "ks2",
      ),
      layoutTemplate(
        {
          template: "exit-ticket",
          heading: "Column addition",
          questions: ["Is 8,252 right?", "Why carry?"],
          answers: ["True", "Because the column holds more than nine."],
        },
        paper,
        "ks2",
      ),
    ].map((r, i) => ({ id: `s${i}`, ...r.slide }) as Slide);

  test("collects practice and exit answers in deck order with their numbers and source titles", () => {
    const groups = answerGroupsOf(deck());
    expect(groups.map((g) => [g.kind, g.title])).toEqual([
      ["practice", "Add using the column method"],
      ["exit", "Column addition"],
    ]);
    expect(groups[0]?.items).toEqual([
      { n: 1, a: "6,245" },
      { n: 2, a: "6,202" },
      { n: 3, a: "9,221" },
    ]);
    expect(groups[1]?.items).toEqual([
      { n: 1, tf: true },
      { n: 2, s: "Because the column holds more than nine." },
    ]);
  });

  test("the guard and Answers slides follow the worksheet answer sheet (ruling 240)", () => {
    const groups = answerGroupsOf(deck());
    expect(endAnswerSlides(groups, paper, "ks2").map((s) => s.answersRole)).toEqual([
      "guard",
      "answers",
    ]);
    expect(endAnswerSlides(groups, paper, "ks2", { worksheetAnswerKey: true })).toEqual([]);
    expect(endAnswerSlides([], paper, "ks2")).toEqual([]);
  });

  test("a rebuild never answers its own Answers slides; a group missing an answer is dropped", () => {
    const d = deck();
    const built = [...d, ...endAnswerSlides(answerGroupsOf(d), paper, "ks2")];
    expect(answerGroupsOf(built)).toEqual(answerGroupsOf(d));
    const holed: AnswerGroup = {
      kind: "practice",
      title: "Holed",
      items: [
        { n: 1, a: "" },
        { n: 2, a: "4" },
      ],
    };
    const slides = endAnswerSlides([holed, ...answerGroupsOf(d)], paper, "ks2");
    expect(slides.flatMap((s) => texts(s).map((x) => x.words))).not.toContain("Holed");
  });

  test("answer strings become items: chips, worked lines, short answers, sentences", () => {
    expect(answerItem(1, "False: they are tiny drops of water.")).toEqual({
      n: 1,
      tf: false,
      why: "they are tiny drops of water.",
    });
    expect(answerItem(2, "4,201 — 2,395 + 1,806 = 4,201")).toEqual({
      n: 2,
      a: "4,201",
      work: "2,395 + 1,806 = 4,201",
    });
    expect(answerItem(3, "Through its roots")).toEqual({ n: 3, a: "Through its roots" });
    expect(answerItem(4, SENTENCE)).toEqual({ n: 4, s: SENTENCE });
  });
});
