import { describe, expect, test } from "bun:test";
import { PLACEHOLDER_IMAGE } from "@tj/slides/layouts";
import { getTheme } from "@tj/slides/themes";
import { materialise, visualsOf } from "./materialise";

/*
 * picq (greatfire 26 Oct, slide 9): the myth slide's proof picture ("A leather bucket carried water
 * to the fire") was never asked, so its slot stayed open and the lesson shipped the grey
 * placeholder. The proof picture is asked like any other picture; one that fails leaves the line.
 */
type S = Record<string, unknown>;
const brief = {
  id: "t",
  topic: "The Great Fire of London",
  subject: "history",
  yearGroup: "Year 2",
  year: 2,
  keyStage: "ks1",
  theme: "paper",
  readingLevel: "",
  language: "en-GB",
  durationMin: 60,
  exitTicketOnSlides: true,
} as S;
const INDEX = 8;
const base = {
  brief,
  theme: getTheme("paper"),
  stage: "ks1",
  plan: { flow: [{ slide: INDEX + 1 }], slides: [] },
} as never;
const SLIDE: S = {
  template: "myth",
  heading: "Like firefighters today?",
  myth: {
    opening: "vote",
    verdict: "myth",
    claim: "People used modern fire engines in London in 1666.",
    // A short fact keeps the proof's slot (a long one gives it way, TEACH-247 part ae).
    fact: "Buckets, not engines.",
    factEm: "Buckets",
    proof: {
      line: "A leather bucket carried water to the fire.",
      icons: null,
      picture: {
        shows: "A seventeenth-century leather fire bucket",
        must_see: ["leather bucket body", "strong carrying handle"],
        subject: "generic",
      },
    },
  },
};
const srcs = (m: ReturnType<typeof materialise>) =>
  JSON.stringify(m.slide.elements).match(/"src":"[^"]*"/g) ?? [];

describe("the myth slide's proof picture is asked and never ships a placeholder", () => {
  test("the proof picture is a photo ask under the key proof", () => {
    const asks = visualsOf(SLIDE, INDEX, base);
    expect(asks.map((a) => [a.key, a.type])).toEqual([["proof", "photo"]]);
    expect(asks[0]?.type === "photo" && asks[0].shows).toBe(
      "A seventeenth-century leather fire bucket",
    );
  });
  test("a placed proof picture is shown", () => {
    const m = materialise(SLIDE, {
      ...(base as object),
      index: INDEX,
      visual: () => ({
        status: "photo",
        photo: { src: "/files/bucket.png", alt: "A leather bucket", aspect: 1, request: "" },
      }),
    } as never);
    expect(srcs(m).join()).toContain("/files/bucket.png");
  });
  test("a failed proof picture leaves the line and no placeholder", () => {
    const m = materialise(SLIDE, {
      ...(base as object),
      index: INDEX,
      visual: () => ({ status: "failed" }),
    } as never);
    expect(srcs(m).join()).not.toContain(PLACEHOLDER_IMAGE);
    expect(JSON.stringify(m.slide.elements)).toContain("A leather bucket carried water");
  });
});
