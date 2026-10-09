import { describe, expect, test } from "bun:test";
import { type Slide, type SlideElement, SlideSchema } from "@tj/domain/documents";
import { getTheme, MIN_FONT_SIZE } from "../themes";
import { ACTIVITY_LIMITS, LEAKS, shuffled } from "./activities";
import {
  ACTIVITY_STAGES,
  ACTIVITY_VARIANTS,
  activityOver,
  measureActivities,
} from "./activity-capacity";
import table from "./activity-capacity.json";
import { activityFixtures } from "./activity-fixtures";
import { layoutTemplate, type TemplateInput } from "./index";

const FIX = activityFixtures((n) => ({ src: `/files/act/${n}.jpg`, aspect: 4 / 3 }));
const themeFor = (stage: string) => getTheme(stage === "ks1" ? "splash" : "studio");
const lay = (input: TemplateInput, stage: "ks1" | "ks4") =>
  layoutTemplate(input, themeFor(stage), stage);
const texts = (els: SlideElement[]) =>
  els.filter((e) => e.type === "text" || e.type === "gap-text");
/** The plain words of a text element (bold markers and gap tokens kept as written). */
const plain = (e: SlideElement): string => {
  const walk = (n: unknown): string =>
    !n || typeof n !== "object"
      ? ""
      : "text" in n
        ? String((n as { text: string }).text)
        : ((n as { content?: unknown[] }).content ?? []).map(walk).join("");
  return "doc" in e ? walk(e.doc).trim() : "";
};
const byId = (els: SlideElement[], id: string) => els.find((e) => e.id === id);

const KIND = {
  pair: "image-match",
  "group-sort": "fill-gap",
  sequence: "sort",
  choose: "multiple-choice",
  "odd-one-out": "multiple-choice",
  label: "fill-gap",
} as const;

describe("activity fixtures (KS1 and KS4)", () => {
  test("there is one fixture per template at each of KS1 and KS4", () => {
    for (const id of Object.keys(ACTIVITY_LIMITS))
      expect(FIX.filter((f) => f.name === id).map((f) => f.stage)).toEqual(["ks1", "ks4"]);
  });

  for (const f of FIX)
    test(`${f.name} ${f.stage}: fits, validates, hides its answer in question data`, () => {
      const r = lay(f.input, f.stage as "ks1" | "ks4");
      expect(r.over).toEqual([]);
      const slide = { id: "s1", ...r.slide } as Slide;
      expect(SlideSchema.safeParse(slide).success).toBe(true);
      expect(r.slide.question?.type).toBe(KIND[f.name as keyof typeof KIND]);
      // Nothing is set under the type floor: every text keeps the template scale's size.
      for (const e of texts(r.slide.elements))
        expect((e as { style: { fontSize: number } }).style.fontSize).toBeGreaterThanOrEqual(
          MIN_FONT_SIZE.body,
        );
      // Nothing is on a reveal step: the answer lives only in `question`.
      expect(r.slide.elements.some((e) => (e.revealStep ?? 0) > 0)).toBe(false);
      // Every card picture is one slot: an image with its own request text.
      for (const e of r.slide.elements)
        if (e.type === "image" && e.name === "Photo") expect(e.src).toStartWith("/files/act/");
      expect(r.slide.elements.every((e) => e.x >= 0 && e.y >= 0 && e.x + e.w <= 960)).toBe(true);
    });
});

describe("the question side never gives the answer away", () => {
  test("pair: no word sits under its own picture", () => {
    for (const f of FIX.filter((x) => x.name === "pair")) {
      const r = lay(f.input, f.stage as "ks1" | "ks4");
      const q = r.slide.question;
      if (q?.type !== "image-match") throw new Error("no image-match");
      for (const p of q.pairs) {
        const img = byId(r.slide.elements, p.imageId) as SlideElement;
        const word = byId(r.slide.elements, p.labelId) as SlideElement;
        // The right word is never the one in the slot under its picture.
        expect(Math.abs(word.x + word.w / 2 - (img.x + img.w / 2))).toBeGreaterThan(img.w / 2);
      }
    }
  });

  test("sequence: shown out of order, never reversed, no card in its place", () => {
    for (const f of FIX.filter((x) => x.name === "sequence")) {
      const r = lay(f.input, f.stage as "ks1" | "ks4");
      const q = r.slide.question;
      if (q?.type !== "sort") throw new Error("no sort");
      const xs = q.order.map((id) => (byId(r.slide.elements, id) as SlideElement).x);
      const shown = xs.map((x) => [...xs].sort((a, b) => a - b).indexOf(x));
      expect(LEAKS.sequence(shown)).toBe(false);
    }
  });

  test("group sort: no group's cards sit together; the gaps list each group's card numbers", () => {
    for (const f of FIX.filter((x) => x.name === "group-sort")) {
      const r = lay(f.input, f.stage as "ks1" | "ks4");
      const q = r.slide.question;
      if (q?.type !== "fill-gap") throw new Error("no fill-gap");
      const shown = q.gaps.flatMap((g, gi) => g.answer.split(", ").map((n) => [Number(n), gi]));
      const groups = shown.sort((a, b) => (a[0] as number) - (b[0] as number)).map((x) => x[1]);
      expect(groups.length).toBe(f.input.cards?.length ?? 0);
      expect(LEAKS.groups(groups as number[])).toBe(false);
      // The answers are not printed anywhere on the question side.
      const words = texts(r.slide.elements).map((e) => plain(e));
      for (const g of q.gaps) expect(words).not.toContain(g.answer);
    }
  });

  test("choose and odd one out: the cards are not in the order written; one is right", () => {
    for (const f of FIX.filter((x) => x.name === "choose" || x.name === "odd-one-out")) {
      const r = lay(f.input, f.stage as "ks1" | "ks4");
      const q = r.slide.question;
      if (q?.type !== "multiple-choice") throw new Error("no multiple-choice");
      expect(q.options.filter((o) => o.correct)).toHaveLength(1);
      const right = q.options.find((o) => o.correct) as { id: string };
      const card = byId(r.slide.elements, right.id) as SlideElement;
      const word = f.input.cards?.[(f.input.correct ?? 1) - 1]?.text;
      const inside = texts(r.slide.elements).find(
        (e) => e.x > card.x && e.x < card.x + card.w && e.y > card.y && e.y < card.y + card.h,
      );
      expect(inside && plain(inside)).toBe(word);
      expect(LEAKS.choose(shuffled(f.input.cards?.length ?? 0, "x", LEAKS.choose))).toBe(false);
    }
  });

  test("label: the word bank is not in the pointers' order", () => {
    for (const f of FIX.filter((x) => x.name === "label")) {
      const r = lay(f.input, f.stage as "ks1" | "ks4");
      const q = r.slide.question;
      if (q?.type !== "fill-gap") throw new Error("no fill-gap");
      const bank = plain(
        r.slide.elements.find((e) => e.name === "Word bank words") as SlideElement,
      ).split(/\s+·\s+/);
      expect(
        LEAKS.bank(
          bank,
          q.gaps.map((g) => g.answer),
        ),
      ).toBe(false);
      expect(bank).toContain(f.input.extra?.[0] as string);
    }
  });

  test("a photo is never labelled", () => {
    const f = FIX.find((x) => x.name === "label") as (typeof FIX)[number];
    const r = lay({ ...f.input, figure: { photo: "/files/act/frog.jpg" } }, "ks1");
    expect(r.over.some((o) => o.includes("photo"))).toBe(true);
  });
});

describe("a failed picture never leaves an empty ask", () => {
  test("choose: a card with no picture is a word-only card in the same place", () => {
    const f = FIX.find((x) => x.name === "choose") as (typeof FIX)[number];
    const cards = (f.input.cards ?? []).map((c, i) => (i === 1 ? { text: c.text } : c));
    const r = lay({ ...f.input, cards }, "ks1");
    expect(r.over).toEqual([]);
    const imgs = r.slide.elements.filter((e) => e.type === "image");
    expect(imgs).toHaveLength(cards.length - 1);
    expect(imgs.every((e) => e.type === "image" && e.src)).toBe(true);
  });

  test("pair: any failed picture makes every card a word and the answer a matching", () => {
    const f = FIX.find((x) => x.name === "pair") as (typeof FIX)[number];
    const cards = (f.input.cards ?? []).map((c, i) => (i === 0 ? { text: c.text } : c));
    const r = lay({ ...f.input, cards }, "ks1");
    expect(r.slide.question?.type).toBe("matching");
    expect(r.slide.elements.some((e) => e.type === "image")).toBe(false);
    expect(SlideSchema.safeParse({ id: "s", ...r.slide }).success).toBe(true);
  });
});

describe("activity capacity tables", () => {
  test("the stored table is what the layouts measure", () => {
    expect(measureActivities()).toEqual(table);
  });

  for (const [id, variants] of Object.entries(ACTIVITY_VARIANTS))
    for (const { key, stage, theme } of ACTIVITY_STAGES)
      for (const v of variants) {
        const n = (table as Record<string, Record<string, Record<string, number>>>)[id]?.[key]?.[
          v.label
        ];
        if (!n || n >= 60) continue;
        test(`${id} ${key} ${v.label}: fits at ${n}, over at ${n + 2}`, () => {
          expect(activityOver(id as never, v, n, stage, theme)).toEqual([]);
          expect(activityOver(id as never, v, n + 2, stage, theme).length).toBeGreaterThan(0);
        });
      }
});

describe("template question slides reveal (hinge and question lists)", () => {
  const theme = getTheme("studio");
  test("a hinge with `correct` marks that option card right in question data", () => {
    const r = layoutTemplate(
      {
        template: "hinge",
        heading: "Check",
        stem: "Which is a mammal?",
        options: ["Frog", "Whale", "Shark"],
        correct: 2,
        explanation: "Whales breathe air and feed milk.",
      },
      theme,
      "ks3",
    );
    const q = r.slide.question;
    if (q?.type !== "multiple-choice") throw new Error("no question");
    expect(q.options.map((o) => o.correct)).toEqual([false, true, false]);
    expect(q.explanation).toBe("Whales breathe air and feed milk.");
    const card = byId(r.slide.elements, q.options[1]?.id as string);
    expect(card?.name).toBe("Option");
    expect(SlideSchema.safeParse({ id: "s", ...r.slide }).success).toBe(true);
  });

  test("a hinge with no `correct` has no question, as before", () => {
    const r = layoutTemplate(
      { template: "hinge", heading: "Check", stem: "Which?", options: ["A", "B"] },
      theme,
      "ks3",
    );
    expect(r.slide.question).toBeUndefined();
  });

  for (const template of ["question-set", "practice", "exit-ticket"] as const)
    test(`${template} with answers carries them as a numbered model answer`, () => {
      const r = layoutTemplate(
        { template, heading: "Try", questions: ["2 + 2?", "3 + 3?"], answers: ["4", "6"] },
        theme,
        "ks3",
      );
      expect(r.slide.question).toEqual({ type: "open-response", modelAnswer: "1. 4\n2. 6" });
    });
});
