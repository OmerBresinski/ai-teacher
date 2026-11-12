import { describe, expect, test } from "bun:test";
import {
  MADE_PICTURE_RULES,
  type PickOrRequeryInput,
  PickOrRequerySchema,
  pickOrRequeryPrompt,
  pickOrRequerySchemaFor,
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

describe("pick-or-requery v21: the picture shows what this slide's words name (12 Nov review)", () => {
  test("the answer is written in order: needs, then pick and seen, then showsNeeds, before the verdicts", () => {
    const keys = Object.keys(PickOrRequerySchema.in.shape);
    expect(keys.slice(0, 4)).toEqual(["needs", "pick", "seen", "showsNeeds"]);
    expect(keys.indexOf("showsNeeds")).toBeLessThan(keys.indexOf("fits"));
    // The examples in the system text follow the same order.
    const s = pickOrRequeryPrompt.system;
    expect(s.indexOf('"needs"')).toBeLessThan(s.indexOf('"pick": "27147699"'));
    expect(s.indexOf('"showsNeeds": true')).toBeLessThan(s.indexOf('"fits": true'));
  });

  test("an answer that leaves out showsNeeds reads as false", () => {
    const recorded = {
      pick: "commons-51034772",
      onSubject: true,
      clear: true,
      fits: true,
      why: "The painting shows buildings burning, though it does not show people passing buckets.",
      visible: ["burning building"],
    };
    const parsed = pickOrRequerySchemaFor({ mustShow: ["burning building"] }).parse(recorded);
    expect(parsed.showsNeeds).toBe(false);
    expect(parsed.needs).toBeNull();
  });

  test("the system text defines needs from the slide's own words and ties fits to showsNeeds", () => {
    const s = pickOrRequeryPrompt.system;
    expect(s).toContain("- `needs`: write this first, before you look at the candidates");
    expect(s).toContain("the living thing, time and place it belongs to");
    expect(s).toContain("When `showsNeeds` is false, `fits` is false too.");
    expect(s).toContain(
      "One required item in view does not make it true when that item is only the setting.",
    );
    expect(s.indexOf("- `needs`:")).toBeLessThan(s.indexOf("- `pick`:"));
  });

  test("a non-exhaustive item list still asks for what needs names; the painted rules keep needs", () => {
    const text = pickOrRequeryPrompt.user({ ...input, needAll: false });
    expect(text).toContain(
      "at least one must be visible, and the picture must also show what `needs` names",
    );
    expect(MADE_PICTURE_RULES).toContain("the list below is only for `fits`");
    expect(MADE_PICTURE_RULES).toContain(
      "or the wanted one in a different kind of living thing, time or place from the one this slide's words and the lesson give",
    );
  });

  test("the slide's words reach the judge on the This slide line", () => {
    const text = pickOrRequeryPrompt.user({
      ...input,
      slideBrief: "Water buckets. People passed buckets of water to throw on flames.",
    });
    expect(text).toContain(
      "This slide: Water buckets. People passed buckets of water to throw on flames.",
    );
  });
});
