import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import type { Brief } from "../writer/fixes";
import { materialise } from "../writer/materialise";
import { fixture, type J, runFile, writerSlides } from "./harness";

/* Group G (layout): register proofs from lab/register-proofs, inverted by the fix (TEACH-75 part b). */

describe("REGISTER layout-06: a two-line title crowds the text below it (d52 T5 y6 s7)", () => {
  test("FIXED layout-06: the body starts at the measured heading bottom plus the template gap", () => {
    const run = "d52_T5_y6-science-heart-circulation";
    const brief = JSON.parse(runFile(run, "brief.json")) as Brief;
    const s = writerSlides(run)[4] as J;
    expect(s.heading).toBe("Why does exercise change your heartbeat?");
    const m = materialise(s, {
      brief,
      theme: getTheme("splash", "KS2" as never),
      stage: "KS2" as never,
      index: 6,
      plan: { slides: [] },
      visual: () => ({ status: "pending" }),
    });
    const els = m.slide.elements as unknown as J[];
    const head = els.find((e) => e.name === "Heading") as J;
    const lead = els.find((e) => e.name === "Lead") as J;
    // Ruling 198: the photo and points fill the band to its foot, so there is no room to move the
    // body down: the title steps down to one line instead, and the one-line gap holds.
    expect(Number(head.h)).toBeLessThan(60);
    expect(Number((head.style as J).fontSize)).toBeLessThan(48);
    expect(Number(lead.y) - (Number(head.y) + Number(head.h))).toBeGreaterThanOrEqual(45);
    for (const e of els) expect(Number(e.y) + Number(e.h)).toBeLessThanOrEqual(540);
  });
});

describe("REGISTER prod-11: a mid-lesson question-set is laid as a 'Do now' starter (pr438-writer-2 s5)", () => {
  const shipped = fixture<{ kind: string; elements: J[] }>("prod-11");
  const items = shipped.elements.filter((e) => e.name === "Item").map((e) => String(e.text));
  const qs = {
    template: "question-set",
    heading: "Explain how the bear survives",
    questions: items,
  };
  const teach = {
    template: "visual-text",
    heading: "Polar bears",
    lead: "Fur and fat keep heat in.",
  };
  const lay = (index: number, slides: J[]) =>
    materialise(qs, {
      brief: { yearGroup: "Year 7", subject: "Science", topic: "Adaptation" } as Brief,
      theme: getTheme("studio", "KS3" as never),
      stage: "KS3" as never,
      index,
      plan: { slides } as never,
      visual: () => ({ status: "pending" }),
    }).slide.kind;
  test("FIXED prod-11: after the first teaching slide the question set is a check, not a starter", () => {
    expect(shipped.kind).toBe("starter"); // as shipped
    expect(lay(5, [{}, {}, teach, teach, teach, qs])).toBe("open-response");
  });
  test("a question set before any teaching stays the starter (retrieval)", () => {
    expect(lay(2, [{}, {}, qs, teach])).toBe("starter");
  });
});
