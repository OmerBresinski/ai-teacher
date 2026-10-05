import { describe, expect, test } from "bun:test";
import { diagramFault, TEXT_CROWDS_DRAWING } from "../stages/plan-write";
import { diagramDisagreements } from "./diagram-agree";
import { DiagramSpecSchema } from "./diagram-spec";
import { withPictureZone } from "./simple";

const base = { heading: "H", body: ["one"], items: ["step 1", "step 2"], questions: [], notes: "" };

describe("DIAGRAM-AUDIT generation fixes", () => {
  test("a drawing on a worked example, sequence or compare keeps a picture zone", () => {
    for (const form of ["worked-example", "sequence", "compare"]) {
      const s = withPictureZone({ ...base, form, picture: { kind: "diagram", spec: {} } } as never);
      expect(s.form).toBe("photo");
      expect(s.body).toEqual(["one", "step 1", "step 2"]);
    }
    const photo = withPictureZone({
      ...base,
      form: "worked-example",
      picture: { subject: "x", named: null },
    } as never);
    expect(photo.form).toBe("worked-example");
  });

  test("a valid spec that does not draw blames the text, not the drawing", () => {
    const spec = { kind: "table", alt: "t", header: ["A"], rows: [["1"]] };
    expect(diagramFault(spec)).toBe(TEXT_CROWDS_DRAWING);
    expect(diagramFault(spec)).not.toContain("fewer parts");
  });

  test("a table's numbers need not appear in the text", () => {
    const table = {
      kind: "table",
      alt: "Stages",
      header: ["Stage", "Age"],
      rows: [
        ["Oral", "0-1"],
        ["Anal", "1-3"],
        ["Phallic", "3-6"],
      ],
    };
    expect(diagramDisagreements(table, "Freud named psychosexual stages.")).toEqual([]);
    const bars = {
      kind: "bar-model",
      alt: "b",
      bars: [{ label: "A", parts: [{ label: "12" }, { label: "12" }], total: "24" }],
    };
    expect(diagramDisagreements(bars, "Share the sweets.").length).toBeGreaterThan(0);
  });

  test("the mirror accepts what the renderer draws", () => {
    expect(
      DiagramSpecSchema.safeParse({ kind: "particles", alt: "d", show: "diffusion" }).success,
    ).toBe(true);
    expect(
      DiagramSpecSchema.safeParse({
        kind: "timeline",
        alt: "t",
        events: [
          { date: "1914", text: "a" },
          { date: "1918", text: "b" },
        ],
      }).success,
    ).toBe(true);
  });
});
