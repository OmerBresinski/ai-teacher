import { describe, expect, test } from "bun:test";
import { diagramEls, eventsOf, type J, stageRun } from "./harness";

/*
 * Register proofs for the repairs that made slides worse (SIMPLIFY S3, TEACH-312 part f), copied
 * from lab/register-proofs and inverted as each fix lands. Recorded writer text, every chat and
 * drawer call refused ($0).
 */

describe("REGISTER checker-01: a flow that drew is dropped for missing its side slot (base4f-p123-1 y12 s4)", () => {
  test("FIXED checker-01: the slide is no longer turned into words; the writer's slide stays", async () => {
    const { events, chats } = await stageRun("base4f-p123-1_y12-psychology-multi-store-model");
    const ev = eventsOf(events, 4);
    expect(String(ev.find((e) => e.ev === "r2-spec-fault")?.fault)).toContain(
      "does not fit its slot (348 by 284 points)",
    );
    // Was words-figure-dropped after a refused stand-alone rewrite call.
    expect(ev.find((e) => e.ev === "visual-path")?.path).toBe("unshown");
    expect(ev.some((e) => e.ev === "restage-fallback")).toBe(false);
    expect(chats.filter((c) => c === "slide").length).toBeLessThan(4);
  }, 60_000);
});

describe("REGISTER checker-04: the objective repair turns a picture task into words (b4-ex-1 y2, d52 A y1)", () => {
  test.each([["b4-ex-1_y2-maths-halves-quarters"], ["d52_A_y1-science-animals-young"]])(
    "FIXED checker-04 %s: no objective_repair call is made; the gap is logged",
    async (run) => {
      const { chats, events } = await stageRun(run);
      expect(chats).not.toContain("objective_repair");
      expect(events.some((e) => e.ev === "coverage-unmet")).toBe(true);
    },
    60_000,
  );
});

describe("REGISTER content-05: the 1-20 number table becomes a bullet list (d52 A y8 s6)", () => {
  test("FIXED content-05: no table-text; the writer's points stay, the rows go to the notes", async () => {
    const { out, events } = await stageRun("d52_A_y8-french-my-family");
    const ev = eventsOf(events, 6);
    expect(ev.find((e) => e.ev === "visual-path")?.path).toBe("unshown");
    const els = (out.slides[5]?.elements ?? []) as J[];
    expect(diagramEls(els).length).toBe(0);
    expect(JSON.stringify(els)).toContain("Il est gentil");
    expect(JSON.stringify(els)).not.toContain("Nombre 1");
    // The table's data is not lost: its rows are in the speaker notes.
    const notes = String(out.slides[5]?.notes ?? "");
    expect(notes).toContain("The table could not be shown on the slide:");
    expect(notes).toContain("douze");
  }, 60_000);
});
