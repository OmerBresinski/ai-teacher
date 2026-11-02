import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPairs, dropLeakingPicks, leakOf, lentAsk } from "./check-pictures";
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

describe("the questions-and-answers shape (review of #752): recorded slides, recorded answers", () => {
  // y2 halves and quarters, writer slide 9 (lesson slide 11): practice written as `questions`,
  // its answers ["9", "2", "5"] from the recorded notes call, the shape materialise reads as
  // `answers`. Before this, `checkPairs` read `items` only and saw no answer on such a slide.
  const dir = join(import.meta.dir, "fixtures/replay/y2-maths-halves-quarters");
  const main = JSON.parse(
    (JSON.parse(readFileSync(join(dir, "main.json"), "utf8")) as { text: string }).text,
  ) as { slides: S[] };
  const notes = JSON.parse(readFileSync(join(dir, "notes.json"), "utf8")) as {
    slides: { n: number; answers: string[] | null }[];
  };
  const slide = {
    ...(main.slides[8] as S),
    answers: notes.slides.find((x) => x.n === 11)?.answers,
  };

  test("questions pair with their answers by position", () => {
    expect(slide.template).toBe("practice");
    const pairs = checkPairs(slide);
    expect(pairs.map((p) => p.answer)).toEqual(["9", "2", "5"]);
    expect(pairs[0]?.question).toBe((slide.questions as string[])[0]);
  });

  test("a picture whose request names one of those answers is dropped; cj's guard sees it too", () => {
    const r = dropLeakingPicks({ ...slide, picture: pic("9 strawberries on a plate") });
    expect(r.dropped).toHaveLength(1);
    expect(leakOf(slide, "9 strawberries on a plate")).toBeDefined();
    expect(dropLeakingPicks({ ...slide, picture: pic("A plate of strawberries") }).dropped).toEqual(
      [],
    );
  });
});
