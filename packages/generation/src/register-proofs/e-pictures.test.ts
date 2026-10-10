import { describe, expect, test } from "bun:test";
import { PLACEHOLDER_IMAGE } from "@tj/slides/layouts";
import { type Brief, withLook } from "../writer/fixes";
import { carryPairs, sameFigure } from "../writer/guards";
import { compoundSubjects, splitLanded, splitSlide } from "../writer/lost-picture";
import { materialise, type VisualState } from "../writer/materialise";
import { stripPointTasks } from "../writer/point-guard";
import { fixture, type J, runFile, theme, writerSlides } from "./harness";

/*
 * Group E: picture selection and carry-over. Root cause: picture slots are matched and re-asked
 * by fuzzy request words, one tile at a time, with no fallback that keeps the task's pictures
 * (sameFigure guards.ts:74-80 used for carry at stage.ts:822-829; lostPic split lost-picture.ts:86;
 * partial split never ships stage.ts:1250; failed cards laid as words materialise.ts:415-421;
 * the title picture is the flow's look_at verbatim fixes.ts:285 via stage.ts:557).
 */

describe("REGISTER layout-01: the mother shown with the father's photo after a repair (d52 A y8 s4)", () => {
  test("FIXED layout-01: after a repair the mother keeps the mother's photo and the father his", () => {
    const cols = (fixture("layout-01").slide as J).columns as { picture: { shows: string } }[];
    const [father, mother] = cols.map((c, n) => ({
      key: `col.${n}`,
      type: "photo",
      shows: c.picture.shows,
    }));
    // The near-twin requests still read as the same figure word for word ...
    expect(sameFigure(father as never, mother as never)).toBe(true);
    // ... but carry is by slot first and one-to-one, so the pair never swaps: as laid, and with
    // the repair's keys reversed.
    const same = (b: { type: string; shows: string }, a: { type: string; shows: string }) =>
      sameFigure(b, a);
    const kept = carryPairs([father, mother] as never[], [father, mother] as never[], same);
    expect((kept.get("col.1") as unknown as { shows: string }).shows).toBe(mother?.shows);
    const swapped = [
      { ...mother, key: "col.0" },
      { ...father, key: "col.1" },
    ];
    const moved = carryPairs([father, mother] as never[], swapped as never[], same);
    expect((moved.get("col.0") as unknown as { shows: string }).shows).toBe(mother?.shows);
    expect((moved.get("col.1") as unknown as { shows: string }).shows).toBe(father?.shows);
  });
});

describe("REGISTER layout-03: a picture-matching task ships with no pictures (d52 A y1 s4)", () => {
  const run = "d52_A_y1-science-animals-young";
  test("BUG layout-03: with card.0 and card.2 failed, the pair slide has no image at all (card.1 landed)", () => {
    const brief = JSON.parse(runFile(run, "brief.json")) as Brief;
    const s = writerSlides(run)[1] as J;
    expect(String(s.instruction)).toContain("Match each picture");
    const visual = (k: string): VisualState =>
      k === "card.1"
        ? { status: "photo", photo: { src: "/files/calf.jpg", alt: "calf", aspect: 1 } }
        : { status: "failed" };
    const m = materialise(s, {
      brief,
      theme: theme("KS1"),
      stage: "KS1" as never,
      index: 3,
      plan: { slides: [] },
      visual,
    });
    // BAD OUTCOME (fix PR inverts: retry the card from stock, or re-template the task).
    expect(m.slide.kind).toBe("image-match");
    expect(m.slide.elements.filter((e) => e.type === "image").length).toBe(0);
  });
});

describe("REGISTER layout-04: one animal growing shown as three different dogs (e2e-speed-1 y1 s8)", () => {
  test("BUG layout-04: the lost growth picture is split into three unrelated single asks", () => {
    const s = fixture("layout-04").slide as J;
    const shows = (s.picture as { shows: string }).shows;
    expect(shows).toContain("golden retrievers");
    const subjects = compoundSubjects(shows);
    const split = splitSlide(s, "picture", subjects) as J;
    const asks = [split.picture, ...(split.tiles as J[])] as { shows: string }[];
    // BAD OUTCOME (fix PR inverts: one 3-panel image of the same animal, cut into tiles).
    expect(asks.length).toBe(3);
    expect(asks.every((a) => !a.shows.includes("retriever"))).toBe(true);
  });
});

describe("REGISTER checker-06: pointGuard leaves 'Answer from memory' slides with nothing to look at (base4f-p123-1 y1 s6)", () => {
  test("BUG checker-06: 2 of 6 split tiles landing is not kept, and the pointing task is stripped", () => {
    const s = fixture("checker-06").slide as J;
    // master: a partial split never ships (stage.ts:1250); splitOk would need 2+ and half.
    expect(splitLanded(2, 6)).toBe(false);
    const { removed } = stripPointTasks(s);
    // BAD OUTCOME (fix PR inverts: keep the split or rebuild as a picture-card match).
    expect(removed).toContain("Point to each pair and say the names.");
  });
});

describe("REGISTER prod-01: the title slide ships an empty grey frame (pr440-paid-4 s1)", () => {
  test("BUG prod-01: a several-thing title look becomes one picture asking to see all of it; the shipped frame is PLACEHOLDER_IMAGE", () => {
    // The writer's flow was not recorded; the dropped must-see ('sandy desert dunes') was.
    const look = { kind: "picture", shows: "An Arctic snowfield beside sandy desert dunes" };
    const { slide } = withLook(
      { template: "title", heading: "Surviving the Arctic and the desert" },
      look,
    );
    expect((slide.picture as { must_see: string[] }).must_see).toEqual([look.shows]);
    const shipped = fixture<{ elements: J[] }>("prod-01").elements;
    const photo = shipped.find((e) => e.name === "Photo");
    // BAD OUTCOME (fix PR inverts: one-subject title brief, and no PLACEHOLDER_IMAGE at persist).
    expect(String(photo?.src).startsWith(PLACEHOLDER_IMAGE.slice(0, 40))).toBe(true);
  });
});

describe("REGISTER prod-09: the title photo is off-topic (pr438-writer-2 s1)", () => {
  test("BUG prod-09: the title picture is the flow's look phrase verbatim, never built from the objectives", () => {
    const shipped = fixture<{ elements: J[] }>("prod-09").elements;
    const recall = String(shipped.find((e) => e.name === "Subtitle")?.text);
    expect(recall).toContain("thick coat");
    const look = { kind: "picture", shows: "A person in a thick coat on a cold day" };
    const { slide } = withLook(
      { template: "title", heading: "Surviving the Arctic and the desert" },
      look,
    );
    // BAD OUTCOME (fix PR inverts: code builds the title brief from the objectives' organisms).
    expect((slide.picture as { shows: string }).shows).toBe(look.shows);
    expect(String(shipped.find((e) => e.name === "Photo")?.alt ?? "")).toMatch(
      /snowman|people|woman/i,
    );
  });
});
