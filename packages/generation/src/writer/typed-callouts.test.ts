import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { sampleBriefLesson } from "../testing";
import { type Plan, toInput } from "./materialise";
import { CALLOUT_TYPES, CALLOUTS_DEFAULT, writerSchema } from "./schema";
import { validate } from "./strict-subset";

/*
 * TEACH-75 part e (UX ruling 203, P1): a support point may be a typed callout `{kind, text}`.
 * Off by default, so the production schema is master's byte for byte; on, older outputs still
 * validate and a typed point reaches the template with its kind.
 */
type J = Record<string, unknown>;
const SLIDES = { min: 8, max: 12 };

describe("typed callouts in the writer schema", () => {
  const on = writerSchema("KS2" as never, SLIDES, undefined, { callouts: true }) as J;
  const defs = on.$defs as Record<string, J>;

  test("off by default: the schema is unchanged", () => {
    expect(CALLOUTS_DEFAULT).toBe(false);
    expect(JSON.stringify(writerSchema("KS2" as never, SLIDES))).toBe(
      JSON.stringify(writerSchema("KS2" as never, SLIDES, undefined, { callouts: false })),
    );
    expect(JSON.stringify(writerSchema("KS2" as never, SLIDES))).not.toBe(JSON.stringify(on));
  });

  test("on: plain, labelled and typed points all validate; a bad type does not", () => {
    const slide = (points: unknown[]) => ({
      template: "explain",
      heading: "The heart",
      lead: "The heart is a pump.",
      points,
    });
    expect(validate(defs.explain as J, slide(["a", { label: "Atria", text: "top" }]), on)).toEqual(
      [],
    );
    for (const kind of CALLOUT_TYPES)
      expect(validate(defs.explain as J, slide(["a", { kind, text: "b" }]), on)).toEqual([]);
    expect(validate(defs.explain as J, slide([{ kind: "joke", text: "b" }]), on)).not.toEqual([]);
  });
});

describe("typed callouts reach the template", () => {
  const brief = { ...sampleBriefLesson().brief, keyStage: "KS2" } as never;
  const ctx = {
    brief,
    theme: getTheme(undefined as never, "KS2" as never),
    stage: "KS2" as never,
    index: 0,
    plan: { slides: [] } as unknown as Plan,
    visual: () => ({ status: "failed" }) as never,
  };

  test("a typed point keeps its kind; an unknown kind is dropped; old points are unchanged", () => {
    const input = toInput(
      {
        template: "explain",
        heading: "The heart",
        lead: "The heart is a pump.",
        points: [
          "Plain words.",
          { label: "Atria", text: "the top chambers" },
          { kind: "watch-out", text: "Blood is never blue." },
          { kind: "joke", text: "Not a type." },
        ],
      },
      ctx,
    );
    expect(input.points).toEqual([
      "Plain words.",
      { label: "Atria", text: "the top chambers" },
      { kind: "watch-out", text: "Blood is never blue." },
      "Not a type.",
    ]);
  });
});
