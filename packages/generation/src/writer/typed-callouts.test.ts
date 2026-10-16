import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
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

  test("off by default: the schema hashes to master's (ae15ea9a) at every stage", () => {
    // Pinned from master, not from this code: the default production schema is unchanged. Note
    // `toInput` reads `{kind}` whatever the flag; off only keeps the field out of the model's schema.
    // Repinned for TEACH-75 part u: the items row is live in the schema (no off switch).
    const MASTER: Record<string, string> = {
      // Answer first (ANSWER-BUG.md): the hinge def lost `correct` and its options say the
      // answer comes first. Before: KS1 72261a17, KS2 7ae81170, KS3-5 04108708.
      // TEACH-68 part b: KS1 items-row lead measured (pattern 1 -> 50 chars). Before: a20417f5.
      KS1: "149d25c5d2676ee45ff8ced4d7d8f45ad5d0ce45",
      KS2: "6f0ec48d2398a32ce05b6153164258b3d9178de2",
      "KS3-5": "1c5df3ec65c5f9177683fa2f6140106e34505aaa",
    };
    for (const [stage, hash] of Object.entries(MASTER))
      expect({
        stage,
        hash: createHash("sha1")
          .update(JSON.stringify(writerSchema(stage as never, SLIDES)))
          .digest("hex"),
      }).toEqual({ stage, hash });
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
