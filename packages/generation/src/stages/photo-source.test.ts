import { describe, expect, test } from "bun:test";
import { isSpecificSubject } from "./illustrate";

describe("photo source per brief (ruling 139)", () => {
  test("a named, specific subject goes to Commons first; an everyday scene to Pexels", () => {
    for (const named of [
      "Hadrian's Wall",
      "Roman soldiers on Hadrian's Wall",
      "the River Severn in flood",
      "Roman Colosseum",
      "The Thames Barrier",
    ])
      expect(isSpecificSubject(named)).toBe(true);
    for (const everyday of [
      "Roman soldiers marching",
      "river in flood",
      "children reading",
      "Flooded street",
    ])
      expect(isSpecificSubject(everyday)).toBe(false);
  });
});

describe("the writer's named field (ruling 139)", () => {
  test("a proper name sends the search to Commons with that name; null keeps it to Pexels", async () => {
    const { namedOf } = await import("./plan-write");
    expect(namedOf("Hadrian's Wall")).toEqual({ named: "Hadrian's Wall", specific: true });
    expect(namedOf(null)).toEqual({ specific: false });
    expect(namedOf("  ")).toEqual({ specific: false });
  });

  test("the photo slot's writer schema asks for named and takes null", async () => {
    const { writerSchema } = await import("@tj/slides");
    const schema = writerSchema("photo");
    const base = { heading: "A Roman fort", body: ["One.", "Two."] };
    const brief = { subject: "stone fort ruins", mustShow: ["gate"] };
    expect(schema.safeParse({ ...base, imageBrief: { ...brief, named: null } }).success).toBe(true);
    expect(
      schema.safeParse({ ...base, imageBrief: { ...brief, named: "Housesteads Roman Fort" } })
        .success,
    ).toBe(true);
  });
});

describe("diagram mirror matches the renderer's schema", () => {
  test("a line graph's interval and the spec parse in both", async () => {
    const { DiagramSpecSchema } = await import("../plan-write/diagram-spec");
    const real = await import("@tj/slides/diagrams");
    const spec = {
      kind: "line-graph",
      alt: "Rainfall and river discharge after a storm",
      x: { label: "Hours", min: 0, max: 24 },
      y: { label: "Discharge", min: 0, max: 10 },
      series: [
        {
          label: "Discharge",
          points: [
            [0, 1],
            [12, 8],
            [24, 2],
          ],
        },
      ],
      intervals: [{ from: 6, to: 12, label: "lag time" }],
    };
    expect(DiagramSpecSchema.safeParse(spec).success).toBe(true);
    expect(real.DiagramSpecSchema.safeParse(spec).success).toBe(true);
  });
});
