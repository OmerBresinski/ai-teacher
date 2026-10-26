import { describe, expect, test } from "bun:test";
import { PLACEHOLDER_IMAGE } from "@tj/slides/layouts";
import { getTheme } from "@tj/slides/themes";
import { withLook } from "./fixes";
import { materialise, visualsOf } from "./materialise";
import { waveCCountCaps, waveCDefs, waveCMenu, waveCWords } from "./wave-c";

/*
 * TEACH-247 part ba (reasons layout B): the reasons slide takes one optional picture of the thing,
 * place or event its question asks about, asked like the myth proof's picture and shown at the foot
 * of the question panel. The menu wording is the prompt-engineer's (pack v4.17); only the schema
 * field and its caps are here.
 */
type S = Record<string, unknown>;
const brief = {
  id: "t",
  topic: "The Great Fire of London",
  subject: "history",
  yearGroup: "Year 2",
  year: 2,
  keyStage: "ks1",
  theme: "crayon",
  readingLevel: "",
  language: "en-GB",
  durationMin: 60,
  exitTicketOnSlides: true,
} as S;
const INDEX = 4;
const base = {
  brief,
  theme: getTheme("crayon", "ks1"),
  stage: "ks1",
  plan: { flow: [{ slide: INDEX + 1 }], slides: [] },
} as never;
const SLIDE: S = {
  template: "reasons",
  heading: "Why did the fire spread so quickly?",
  lead: null,
  kind: "reasons",
  items: [
    { head: "Wooden houses", line: "Houses were made of wood and built close.", icon: null },
    { head: "A hot, dry summer", line: "No rain for months left the wood dry.", icon: null },
    { head: "A strong east wind", line: "The wind blew sparks from roof to roof.", icon: null },
  ],
  picture: {
    shows: "The Great Fire of London burning beside the river at night, 1666",
    must_see: ["burning houses", "the river"],
    subject: "generic",
  },
};
const srcs = (m: ReturnType<typeof materialise>) =>
  JSON.stringify(m.slide.elements).match(/"src":"[^"]*"/g) ?? [];
const ctx = (visual: () => unknown, draft = false) =>
  ({ ...(base as object), index: INDEX, visual, ...(draft ? { draft } : {}) }) as never;

describe("the reasons slide's question picture", () => {
  test("the schema offers one optional picture on reasons", () => {
    const defs = waveCDefs("KS1") as { reasons: { properties: S; required?: string[] } };
    expect(defs.reasons.properties.picture).toEqual({
      anyOf: [{ $ref: "#/$defs/picture" }, { type: "null" }],
    });
  });

  test("the menu wording is unchanged by the field (the prompt-engineer's, pack v4.17)", () => {
    expect(waveCMenu("KS1").reasons).toContain("The slide carries no picture or diagram");
  });

  test("a picture slide's question takes the picture cells' cap", () => {
    const W = waveCWords("KS1") as { reasons: S; reasonsPicture: S };
    const plain = waveCCountCaps("reasons", undefined, { ...SLIDE, picture: null }, "KS1");
    const pic = waveCCountCaps("reasons", undefined, SLIDE, "KS1");
    expect(plain.caps.heading).toBe((W.reasons["reasons-3"] as { question: number }).question);
    expect(pic.caps.heading).toBe((W.reasonsPicture["reasons-3"] as { question: number }).question);
    expect(pic.caps.heading).toBeLessThanOrEqual(plain.caps.heading as number);
  });

  test("the picture is a photo ask under the key picture", () => {
    const asks = visualsOf(SLIDE, INDEX, base);
    expect(asks.map((a) => [a.key, a.type])).toEqual([["picture", "photo"]]);
  });

  test("a placed picture is shown at the panel's foot", () => {
    const m = materialise(
      SLIDE,
      ctx(() => ({
        status: "photo",
        photo: { src: "/files/fire.png", alt: "The fire", aspect: 1.72, request: "" },
      })),
    );
    expect(srcs(m).join()).toContain("/files/fire.png");
    expect(JSON.stringify(m.slide.elements)).toContain('"name":"Question picture"');
  });

  test("a picture still to come holds its slot in a draft", () => {
    const m = materialise(
      SLIDE,
      ctx(() => ({ status: "pending" }), true),
    );
    expect(srcs(m).join()).toContain(PLACEHOLDER_IMAGE);
  });

  test("a failed picture leaves the words alone, no placeholder", () => {
    const m = materialise(
      SLIDE,
      ctx(() => ({ status: "failed" })),
    );
    expect(srcs(m).join()).not.toContain(PLACEHOLDER_IMAGE);
    expect(JSON.stringify(m.slide.elements)).not.toContain('"name":"Question picture"');
    expect(JSON.stringify(m.slide.elements)).toContain("Wooden houses");
  });

  test("a plan's picture look lands on the reasons slide's picture", () => {
    const out = withLook(
      { ...SLIDE, picture: null },
      { kind: "picture", shows: "London burning in 1666" },
    );
    expect((out.slide.picture as { shows: string }).shows).toBe("London burning in 1666");
    expect(out.slide.template).toBe("reasons");
  });
});
