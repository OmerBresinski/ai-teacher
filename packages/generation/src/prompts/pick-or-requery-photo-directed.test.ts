import { describe, expect, test } from "bun:test";
import {
  MADE_PICTURE_RULES,
  type PickOrRequeryInput,
  pickOrRequeryPrompt,
} from "./pick-or-requery-photo-directed";

const input: PickOrRequeryInput = {
  topic: "A past event",
  lessonTitle: "A past event",
  audience: { yearGroup: "Year 2", readingLevel: "Year 2", language: "en-GB" },
  objectives: [],
  vocabulary: [],
  slideBrief: "A painted scene of the event.",
  subject: "A painted scene of the event.",
  mustShow: ["a brick oven", "small flames"],
  period: "A city, 1600s",
  purpose: "context",
  queries: [],
  candidates: [{ id: "made", alt: "A painted scene of the event.", thumbnail: "data:" }],
} as PickOrRequeryInput;

describe("pick-or-requery v18: painted pictures (TEACH-251 part x)", () => {
  test("a real photograph's request carries none of the painted rules", () => {
    const text = pickOrRequeryPrompt.user(input);
    expect(text).not.toContain(MADE_PICTURE_RULES);
    expect(text).not.toContain("painting made for this slide");
  });

  test("a generated painting gets the painted rules after its period and items, before the searches", () => {
    const text = pickOrRequeryPrompt.user({ ...input, made: true });
    const at = text.indexOf(MADE_PICTURE_RULES);
    expect(at).toBeGreaterThan(text.indexOf("Period and place: A city, 1600s"));
    expect(at).toBeGreaterThan(text.indexOf("Required items"));
    expect(at).toBeLessThan(text.indexOf("Searches already tried:"));
  });

  test("a reused painting keeps the reuse line after the painted rules", () => {
    const text = pickOrRequeryPrompt.user({ ...input, made: true, reuse: true });
    expect(text.indexOf(MADE_PICTURE_RULES)).toBeLessThan(
      text.indexOf("This picture was made for another slide."),
    );
  });

  test("the painted rules refuse only wrong subject or period, unsuitable content, text or untruth", () => {
    expect(MADE_PICTURE_RULES).toContain("writing, letters or numbers");
    expect(MADE_PICTURE_RULES).toContain("belongs to another time or place");
    expect(MADE_PICTURE_RULES).toContain("people burning, injured or dead");
    expect(MADE_PICTURE_RULES).toContain("frightening for pupils of this age");
    expect(MADE_PICTURE_RULES).toContain("clearly not the age the slide asks for");
    expect(MADE_PICTURE_RULES).toContain("something untrue about the subject");
    // v20: the notice-at-slide-size bar never softens the safety refusals (distress, age).
    expect(MADE_PICTURE_RULES).toContain(
      "A distressing, violent or frightening scene and people clearly not the age the slide asks for are always reasons to refuse, whatever their size. Each other reason counts only",
    );
    expect(MADE_PICTURE_RULES).toContain("composition and style never count");
  });
});

describe("pick-or-requery v19: writing in another language (TEACH-251 part al)", () => {
  const fits = pickOrRequeryPrompt.system.split("\n").find((l) => l.startsWith("- `fits`")) ?? "";

  test("readable writing in a language other than the lesson's makes `fits` false", () => {
    expect(fits).toContain("must be in the lesson's language, given on its Language line");
    expect(fits).toContain("when such writing is in another language, `fits` is false");
  });

  test("place names in the lesson's form and writing that is part of the subject stay fine", () => {
    expect(fits).toContain("Place names written as the lesson's language writes them are fine");
    expect(fits).toContain("an inscription on an artefact");
  });

  test("the rule reads the Language line the user turn carries", () => {
    expect(pickOrRequeryPrompt.user(input)).toContain("Language: ");
  });

  test("v18's period rule and the painted rules are unchanged", () => {
    expect(fits).toContain(
      "When a period and place are given, nothing visible may belong to another time or place.",
    );
    expect(MADE_PICTURE_RULES).toContain("distressing or violent scene");
  });
});
