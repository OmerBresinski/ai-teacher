import { describe, expect, test } from "bun:test";
import { dropLeakingPicks, lentAsk } from "./check-pictures";
import { withLook } from "./fixes";

/*
 * TEACH-247 part cw (CODE-NOTE v4.21 item 2): a picture the writer chose for a check slide passes
 * cj's answer-leak test before it is asked for. v4.21b's pre-check: reusing the teaching picture
 * on practice would leak on 58 of 83 slides (plants s10: "A bean plant has a part that holds it
 * up. What is it?", the stem). A leaking pick is dropped and logged; the slide goes on to cj.
 */
type S = Record<string, unknown>;

const bean: S = {
  template: "practice",
  heading: "Holding a plant up",
  instruction: "Talk to your partner.",
  items: [
    {
      question: "A bean plant has a part that holds it up. What is it?",
      answer: "The stem",
      working: null,
    },
  ],
};
const pic = (shows: string, must_see: string[] = []): S => ({
  shows,
  must_see,
  subject: "generic",
});

describe("dropLeakingPicks: a writer-chosen check picture that names its answer is not asked for", () => {
  test("a practice picture whose request names the answer is dropped, origin writer", () => {
    const s = { ...bean, picture: pic("A bean plant with its stem holding it up") };
    const r = dropLeakingPicks(s);
    expect(r.slide.picture).toBeNull();
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0]).toMatchObject({ key: "picture", origin: "writer" });
    expect(r.dropped[0]?.why).toContain("stem");
    // The rest of the slide is untouched.
    expect(r.slide.items).toEqual(bean.items);
  });

  test("an answer word in must_see alone is a leak too", () => {
    const s = { ...bean, picture: pic("A young bean plant in a pot", ["green stem"]) };
    expect(dropLeakingPicks(s).dropped).toHaveLength(1);
  });

  test("a new case that does not show the answer is kept as the writer chose it", () => {
    const s = { ...bean, picture: pic("A young bean plant growing in a pot", ["bean plant"]) };
    const r = dropLeakingPicks(s);
    expect(r.dropped).toEqual([]);
    expect(r.slide).toBe(s);
  });

  test("the slide's own ask lines are its words, not its picture: not read", () => {
    const s = {
      ...bean,
      picture: { ...pic("A young bean plant growing in a pot"), ask: "Find the stem." },
    };
    expect(dropLeakingPicks(s).dropped).toEqual([]);
  });

  test("a picture withLook added from the flow's look is screened, origin look", () => {
    const look = { kind: "picture", shows: "A bean plant's stem" };
    const added = withLook(bean, look);
    expect(added.how).toBe("figure-from-look");
    const r = dropLeakingPicks(added.slide, "figure");
    expect(r.slide.figure).toBeNull();
    expect(r.dropped).toEqual([expect.objectContaining({ key: "figure", origin: "look" })]);
  });

  test("hinge, exit ticket and quick check are screened; a teaching slide is not", () => {
    const hinge: S = {
      template: "hinge",
      stem: "Which part holds a bean plant up?",
      correct: 1,
      options: [{ text: "The stem" }, { text: "The root" }, { text: "The leaf" }],
      figure: pic("A bean plant with a thick stem"),
    };
    expect(dropLeakingPicks(hinge).dropped).toHaveLength(1);
    for (const template of ["exit-ticket", "question-set"])
      expect(dropLeakingPicks({ ...bean, template, figure: pic("A stem") }).dropped).toHaveLength(
        1,
      );
    const teach: S = { template: "visual-text", heading: "Stems", figure: pic("A stem") };
    expect(dropLeakingPicks(teach)).toEqual({ slide: teach, dropped: [] });
  });

  test("a lent visual is cj's, already screened: left alone", () => {
    const s = { ...bean, picture: lentAsk(pic("A bean plant's stem")) };
    expect(dropLeakingPicks(s).dropped).toEqual([]);
  });
});
