import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { groundIcons, toInput } from "./materialise";

/*
 * TEACH-247 part by: a writer's icon is drawn only when its item's own words name it. Romans
 * replay 29 Oct (20261029-115643-replay-v4-romans2), slide 9: the reroute repair wrote "volcano"
 * for Fort and Milecastle and "portcullis" for Gate, and all three shipped.
 */
type S = Record<string, unknown>;
const INDEX = 8;
const ctx = {
  brief: {
    id: "t",
    topic: "Why the Romans built Hadrian's Wall",
    subject: "",
    yearGroup: "Year 4",
    year: 4,
    keyStage: "ks2",
    theme: "crayon",
    readingLevel: "",
    language: "en-GB",
    durationMin: 80,
    exitTicketOnSlides: true,
  },
  theme: getTheme("crayon"),
  stage: "ks2",
  index: INDEX,
  plan: { flow: [{ slide: INDEX + 1 }], slides: [] },
  visual: () => ({ status: "failed" }),
} as never;

/** The repair's slide exactly as it came back (debug.json, repair seq 99, `after`). */
const romans: S = {
  template: "panel-list",
  heading: "Guarding structures",
  lead: null,
  panel: null,
  items: [
    { name: "Fort", text: "Roman soldiers lived and worked here.", icon: "volcano", picture: null },
    {
      name: "Milecastle",
      text: "A small guarded post along the wall.",
      icon: "volcano",
      picture: null,
    },
    {
      name: "Gate",
      text: "Soldiers guarded this opening for crossings.",
      icon: "portcullis",
      picture: null,
    },
  ],
};
const iconsOf = (inp: unknown) =>
  ((inp as { rows?: { icon?: string | null }[] }).rows ?? []).map((r) => r.icon ?? null);

describe("a writer's icon its item does not name is never drawn", () => {
  test("Romans slide 9: no volcano on Fort or Milecastle, no portcullis on Gate", () => {
    expect(iconsOf(toInput(romans, ctx))).toEqual([null, null, null]);
  });

  test("an icon the item names is kept, beside one it does not", () => {
    const s = {
      ...romans,
      items: [
        { name: "Shields", text: "Protected Roman soldiers.", icon: "shield", picture: null },
        { name: "Taxes", text: "Paid for the army.", icon: "coin", picture: null },
        { name: "Fort", text: "Soldiers lived here.", icon: "volcano", picture: null },
      ],
    };
    expect(iconsOf(toInput(s, ctx))).toEqual(["shield", "coin", null]);
  });

  test("reasons: the same rule, a pending or unknown label left to the layout", () => {
    const s = {
      template: "reasons",
      heading: "Why build a wall?",
      items: [
        { head: "Raids", line: "Tribes attacked from the north.", icon: "volcano" },
        { head: "Money", line: "Traders paid taxes at the gates.", icon: "coin" },
        { head: "Pride", line: "It showed Rome's power.", icon: "(icon pending)" },
      ],
    };
    const items = groundIcons(s).items as S[];
    expect(items.map((i) => i.icon)).toEqual([null, "coin", "(icon pending)"]);
  });

  test("the slide's own icon needs the slide's words", () => {
    expect(groundIcons({ template: "picture-text", heading: "Forts", icon: "volcano" }).icon).toBe(
      null,
    );
    expect(
      groundIcons({ template: "picture-text", heading: "Volcanoes", icon: "volcano" }).icon,
    ).toBe("volcano");
  });
});
