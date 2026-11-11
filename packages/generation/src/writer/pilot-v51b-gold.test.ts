import { describe, expect, test } from "bun:test";
import { fixedFallback } from "./fixes";
import { NO_FIGURE, normalise } from "./materialise";
import { PILOT_PACK_LIVE, PILOT_PACKS } from "./pilot-pack";

/*
 * Pilot pack v5.1b-gold (11 Nov 2026, scratchpad/tuning/v5.1-gold/V51B-NOTES.md): v5.1-gold plus
 * the two fixes its paid proof called for. The live pack and v5.1-gold are untouched.
 */

const KS: ("KS1" | "KS2" | "KS3")[] = ["KS1", "KS2", "KS3"];
const OLD_DISCUSSION =
  "lead is one line to agree or disagree with, or to weigh up; a picture only when the question stands without it.";
const NEW_DISCUSSION =
  "- discussion: an open question with more than one fair answer, for pupils to talk about. The heading is the question; lead is a claim to argue either way, never the answer; a picture only when the question stands without it.";

describe("v5.1b-gold system text", () => {
  test.each(KS)("%s: v5.1-gold's text with only the discussion line changed", (ks) => {
    const a = PILOT_PACKS["v5.1-gold"].system[ks];
    const b = PILOT_PACKS["v5.1b-gold"].system[ks];
    expect(b).toContain(NEW_DISCUSSION);
    expect(b).not.toContain(OLD_DISCUSSION);
    const line = (t: string) => t.split("\n").findIndex((l) => l.startsWith("- discussion:"));
    const la = a.split("\n");
    const lb = b.split("\n");
    expect(lb.length).toBe(la.length);
    lb.splice(line(b), 1);
    la.splice(line(a), 1);
    expect(lb).toEqual(la);
  });
  test("the live pack is not v5.1b-gold", () => {
    expect(PILOT_PACK_LIVE).toBe("v5.0b");
  });
});

describe("fixedFallback: a figure code drops from a picture-and-text slide", () => {
  const slide = {
    template: "visual-text",
    fit: "points-2-fig",
    heading: "Trees",
    lead: "Trees have stems too.",
    points: ["A trunk is a thick, woody stem.", "Branches grow out from the trunk."],
    figure: {
      shows: "A tree with its trunk and branches",
      must_see: ["trunk"],
      subject: "generic",
    },
  };
  const lost = { type: "photo" };
  test("goldNoPicture (v5.1b-gold): the gold picture-and-text's no-picture look, never explain", () => {
    const r = fixedFallback(slide, lost, [], 0, { goldNoPicture: true });
    expect(r.how).toBe("figure-dropped");
    expect(r.slide.template).toBe("visual-text");
    expect(r.slide.figure).toBeNull();
    expect(r.slide.points).toEqual(slide.points);
    expect(normalise(r.slide).template).toBe("picture-text");
  });
  test("goldNoPicture on a catalogue picture-text slide stays picture-text", () => {
    const r = fixedFallback({ ...slide, template: "picture-text" }, lost, [], 0, {
      goldNoPicture: true,
    });
    expect(r.slide.template).toBe("picture-text");
  });
  test("goldNoPicture never touches a slide that does not become explain", () => {
    const hook = {
      template: "hook",
      heading: "Why build a wall?",
      lead: "",
      picture: { shows: "x" },
    };
    const r = fixedFallback(hook, lost, [], 0, { goldNoPicture: true });
    expect(r.slide.template).toBe("hook");
    expect(NO_FIGURE in r.slide).toBe(false);
  });
  test("without it (every other pack) the slide still becomes explain", () => {
    const r = fixedFallback(slide, lost, [], 0);
    expect(r.slide.template).toBe("explain");
    expect(NO_FIGURE in r.slide).toBe(false);
  });
  test("only v5.1b-gold sets the switch", () => {
    const on = Object.entries(PILOT_PACKS)
      .filter(([, p]) => (p as { goldNoPictureFallback?: boolean }).goldNoPictureFallback)
      .map(([id]) => id);
    expect(on).toEqual(["v5.1b-gold"]);
  });
});
