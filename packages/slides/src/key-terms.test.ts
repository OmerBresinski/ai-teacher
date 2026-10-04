import { describe, expect, test } from "bun:test";
import type { RichNode, Slide, SlideElement } from "@tj/domain/documents";
import { lessonKeyTerms, withKeyTerms } from "./key-terms";
import { materialiseSlide } from "./materialise";
import { HEADING_NAME } from "./reflow";
import type { SlideSpec } from "./specs";

/* UX ruling 150: key terms bold at their first use on each teaching slide. */

const meta = { promptVersion: "t", model: "m", at: "2026-10-04T00:00:00.000Z" };
const factRefs: string[] = [];
const THEME = "chalk";

const make = (spec: SlideSpec, terms?: string[]) =>
  materialiseSlide(spec, THEME, meta, undefined, undefined, terms ? { terms } : {});

function textNodes(elements: readonly SlideElement[]): { el: SlideElement; node: RichNode }[] {
  const out: { el: SlideElement; node: RichNode }[] = [];
  const walk = (el: SlideElement, nodes: RichNode[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === "text") out.push({ el, node });
      walk(el, node.content);
    }
  };
  for (const el of elements) {
    if (el.type === "text" || el.type === "option") walk(el, el.doc.content as RichNode[]);
    if (el.type === "group") out.push(...textNodes(el.children));
  }
  return out;
}

/** The bold runs on a slide, lower-cased. */
const bold = (slide: Slide) =>
  textNodes(slide.elements)
    .filter(({ node }) => node.marks?.some((m) => m.type === "bold"))
    .map(({ node }) => (node.text ?? "").toLowerCase());

const content = (body: string, heading = "Money in 1923"): SlideSpec => ({
  kind: "content",
  factRefs,
  heading,
  body,
});

const LONG =
  "Prices in Germany rose a little in 1922. By 1923 the government printed money to pay its debts, and prices doubled every few days. This extreme, rapid rise is hyperinflation. Hyperinflation wiped out the savings of the middle classes.";

describe("key terms (ruling 150)", () => {
  test("first use only: the first 'hyperinflation' is bold, the second is plain", () => {
    expect(bold(make(content(LONG), ["hyperinflation"]))).toEqual(["hyperinflation"]);
  });

  test("whole words: 'inflation' is not marked inside 'hyperinflation'", () => {
    expect(bold(make(content(LONG), ["inflation"]))).toEqual([]);
  });

  test("case-insensitive, simple plurals included", () => {
    const slide = make(
      content(
        "Tariffs made imports dearer for German firms after the war. The Allies demanded reparations from Germany. Trade with Britain and France fell further.",
      ),
      ["tariff", "Reparation"],
    );
    expect(bold(slide).sort()).toEqual(["reparations", "tariffs"]);
  });

  test("every term on the slide is marked; there is no cap", () => {
    const slide = make(
      content(
        "The Treaty of Versailles made Germany pay reparations. When Germany missed a payment, France began the occupation of the Ruhr. Workers went on strike, the government printed money and hyperinflation followed.",
      ),
      ["reparations", "occupation", "hyperinflation"],
    );
    expect(bold(slide).sort()).toEqual(["hyperinflation", "occupation", "reparations"]);
  });

  test("never in the heading", () => {
    const slide = make(content(LONG, "What was hyperinflation?"), ["hyperinflation"]);
    const heading = textNodes(slide.elements).filter(({ el }) => el.name === HEADING_NAME);
    expect(heading.length).toBeGreaterThan(0);
    expect(heading.some(({ node }) => node.marks?.some((m) => m.type === "bold"))).toBe(false);
    expect(bold(slide)).toEqual(["hyperinflation"]);
  });

  test("never in a question stem, an option or an answer", () => {
    const terms = ["hyperinflation"];
    const specs: SlideSpec[] = [
      {
        kind: "true-false",
        factRefs,
        statement: "Hyperinflation made savings worthless.",
        correct: true,
      },
      {
        kind: "multiple-choice",
        factRefs,
        stem: "What is hyperinflation?",
        options: [
          { text: "Hyperinflation is a very rapid rise in prices", correct: true },
          { text: "A fall in prices", correct: false },
          { text: "A new currency", correct: false },
          { text: "A tax on bread", correct: false },
        ],
      },
      {
        kind: "open-response",
        factRefs,
        stem: "Explain how hyperinflation hurt savers.",
        modelAnswer: "Hyperinflation made their savings worthless.",
      },
      { kind: "starter", factRefs, items: ["What is hyperinflation?"] },
      {
        kind: "worked-example",
        factRefs,
        question: "How did hyperinflation start?",
        steps: ["The government printed money", "Prices rose: hyperinflation"],
      },
    ];
    for (const spec of specs) expect(bold(make(spec, terms))).toEqual([]);
  });

  test("an image-text slide marks its first use too", () => {
    const slide = make(
      {
        kind: "image-text",
        factRefs,
        heading: "A wheelbarrow of money",
        body: "In 1923 people carried banknotes in wheelbarrows. This was hyperinflation at its worst.",
      },
      ["hyperinflation"],
    );
    expect(bold(slide)).toEqual(["hyperinflation"]);
  });

  test("no double bolding: a term already bold stays one run, a later use stays plain", () => {
    const slide = make(content(LONG), ["hyperinflation"]);
    const again = withKeyTerms(withKeyTerms([slide], THEME, ["hyperinflation"]), THEME, [
      "hyperinflation",
    ])[0] as Slide;
    expect(bold(again)).toEqual(["hyperinflation"]);
    // The writer's own bold (no accent chip) counts as marked.
    const first = slide.elements.find(
      (e) => e.type === "text" && e.name !== HEADING_NAME && e.style.preset === "body",
    );
    const own: Slide = {
      ...slide,
      elements: slide.elements.map((e) =>
        e === first && e.type === "text"
          ? {
              ...e,
              doc: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "Hyperinflation", marks: [{ type: "bold" }] },
                      { type: "text", text: " ruined savers." },
                    ],
                  },
                ],
              },
            }
          : e,
      ),
    };
    expect(bold(withKeyTerms([own], THEME, ["hyperinflation"])[0] as Slide)).toEqual([
      "hyperinflation",
    ]);
  });

  test("withKeyTerms leaves non-teaching slides alone", () => {
    const tf = make({
      kind: "true-false",
      factRefs,
      statement: "Hyperinflation hit 1923.",
      correct: true,
    });
    expect(withKeyTerms([tf], THEME, ["hyperinflation"])[0]).toBe(tf);
  });

  test("lessonKeyTerms: the facts' vocabulary, then terms only a vocabulary slide prints", () => {
    const vocab = make({
      kind: "vocabulary",
      factRefs,
      entries: [
        { term: "Hyperinflation", definition: "Prices rising very fast." },
        { term: "Reparations", definition: "Money paid for war damage." },
      ],
    });
    expect(lessonKeyTerms({ slides: [vocab] }).sort()).toEqual(["Hyperinflation", "Reparations"]);
    const terms = lessonKeyTerms({
      facts: {
        vocabulary: [{ id: "v1", term: "hyperinflation", definition: "x", objectiveRefs: [] }],
      },
      slides: [vocab],
    });
    expect(terms.map((t) => t.toLowerCase()).sort()).toEqual(["hyperinflation", "reparations"]);
  });
});
