import { describe, expect, test } from "bun:test";
import { resolveIcon } from "@tj/slides/icons";
import { drawsOwnVisual, lookMet } from "./fixes";
import { fitsNoWorse, routeIconMisses } from "./icon-route";

/*
 * TEACH-247 part ci: an icon the closed catalogue lacks is routed to a real visual (the catalogue
 * icon the item names, else the item's own picture), never a near icon, and a slot with no honest
 * visual is a fault. The slides are the saved writer outputs of the rivers, photosynthesis, plants
 * and Great Fire runs in TEXT-ONLY-DIAG.md.
 */
type S = Record<string, unknown>;

const rivers: S = {
  template: "panel-list",
  heading: "Four erosion processes",
  lead: null,
  panel: null,
  items: [
    {
      name: "Hydraulic action",
      text: "Water forces air into cracks in the bank.",
      icon: null,
      picture: null,
    },
    {
      name: "Abrasion",
      text: "Rocks carried by the river scrape the bed.",
      icon: null,
      picture: null,
    },
    {
      name: "Attrition",
      text: "Rocks knock together and become smaller.",
      icon: null,
      picture: null,
    },
    { name: "Solution", text: "Weak acids in the water dissolve rock.", icon: null, picture: null },
  ],
};
const items = (s: S) => s.items as S[];

describe("routeIconMisses", () => {
  test("the rivers erosion processes the catalogue lacks each get their own picture", () => {
    for (const i of items(rivers)) expect(resolveIcon(String(i.name))).toBeNull();
    const r = routeIconMisses(rivers, { around: "Rivers: erosion and meanders" });
    expect(r.route?.to).toBe("picture");
    expect(r.route?.misses.map((m) => m.slot)).toEqual(["row.0", "row.1", "row.2", "row.3"]);
    expect(r.slide.template).toBe("panel-list");
    const pics = items(r.slide).map((i) => i.picture as S);
    expect(pics[1]).toEqual({
      shows: "Abrasion: Rocks carried by the river scrape the bed (Four erosion processes)",
      must_see: ["Abrasion"],
      subject: "generic",
    });
    expect(items(r.slide).every((i) => i.icon === null)).toBe(true);
  });

  test("a stages strip routes the same way, keeping its layout", () => {
    const s: S = {
      template: "stages",
      heading: "How an oxbow lake forms",
      items: [
        { name: "Neck", line: "The loop narrows.", icon: null, picture: null },
        { name: "Cut-off", line: "A flood cuts through.", icon: null, picture: null },
      ],
    };
    const r = routeIconMisses(s);
    expect(r.route?.to).toBe("picture");
    expect(r.slide.template).toBe("stages");
    expect(items(r.slide).map((i) => (i.picture as S).must_see)).toEqual([["Neck"], ["Cut-off"]]);
  });

  test("pictures that would push the words past the layout's room are a fault, not a cut", () => {
    const r = routeIconMisses(rivers, { fits: () => false });
    expect(r.route).toMatchObject({ to: "none", why: "pictures-over" });
    expect(r.slide).toBe(rivers);
  });

  test("a panel list whose title panel holds a picture keeps it; the misses are reported", () => {
    const s = { ...rivers, panel: { picture: { shows: "a river bank", must_see: ["bank"] } } };
    const r = routeIconMisses(s);
    expect(r.route).toMatchObject({ to: "none", why: "panel-picture" });
    expect(r.slide).toBe(s);
  });

  test("an icon the writer left out that the item's own name names comes from the catalogue", () => {
    const s: S = {
      template: "hinge",
      heading: "Which part takes in water?",
      stem: "Which part takes in water?",
      options: [
        { text: "The roots", icon: null },
        { text: "The stem", icon: null },
        { text: "The flower", icon: null },
      ],
    };
    const r = routeIconMisses(s, { around: "Plants", subject: "Science" });
    // "roots" is maths outside a science subject: no subject, no icon (never a guess).
    expect(routeIconMisses(s, { around: "Plants" }).route?.to).toBe("none");
    expect(r.route?.to).toBe("catalogue");
    const ids = (r.slide.options as S[]).map((o) => o.icon);
    expect(ids.every((id) => typeof id === "string" && resolveIcon(id as string))).toBe(true);
    expect(ids).toContain(resolveIcon("stem"));
  });

  test("a hinge of things the catalogue only partly draws is a fault, never a near icon", () => {
    const s: S = {
      template: "hinge",
      heading: "Where did the fire start?",
      stem: "Where did the fire start?",
      options: [
        { text: "A baker's shop", icon: null },
        { text: "A wooden house", icon: null },
        { text: "A shop selling buckets", icon: null },
      ],
    };
    const r = routeIconMisses(s, { around: "The Great Fire of London" });
    expect(r.route?.to).toBe("none");
    expect(r.route?.why).toBe("hinge-no-picture-tile");
    expect(r.slide).toBe(s);
  });

  test("a word hinge (statements or numbers) wants no icon and is left alone", () => {
    const s: S = {
      template: "hinge",
      heading: "Solve it",
      options: [{ text: "x = 5" }, { text: "x = 8.5" }, { text: "Subtract 5 from both sides" }],
    };
    expect(routeIconMisses(s).route).toBeUndefined();
  });

  test("a myth proof line with no icon the catalogue draws gets its own picture", () => {
    const s: S = {
      template: "myth",
      heading: "Plants eat soil",
      myth: {
        claim: "Plants eat soil.",
        fact: "Plants make glucose.",
        proof: { line: "A willow gained 74 kg; the soil lost 57 g.", icons: null, picture: null },
      },
    };
    const r = routeIconMisses(s);
    expect(r.route?.to).toBe("picture");
    expect(((r.slide.myth as S).proof as S).picture).toMatchObject({ subject: "generic" });
    expect(routeIconMisses(s, { fits: () => false }).route).toMatchObject({ to: "none" });
  });

  test("a full icon row, a pictured row and a slide with no icon slots are untouched", () => {
    const iconed = {
      ...rivers,
      items: items(rivers).map((i) => ({ ...i, icon: resolveIcon("water") })),
    };
    expect(routeIconMisses(iconed).route).toBeUndefined();
    const pictured = {
      ...rivers,
      items: items(rivers).map((i) => ({ ...i, picture: { shows: String(i.name) } })),
    };
    expect(routeIconMisses(pictured).route).toBeUndefined();
    expect(routeIconMisses({ template: "explain", heading: "x" }).route).toBeUndefined();
  });
});

describe("lookMet on pilot layouts (the !isPilot exemption is gone)", () => {
  const look = { kind: "picture" };
  test("an all-null icon row does not meet a look that asks for a visual", () => {
    expect(drawsOwnVisual(rivers)).toBe(false);
    expect(lookMet(rivers, look)).toBe(false);
  });
  test("one icon short is not met either (icons are all or none)", () => {
    const s = {
      ...rivers,
      items: items(rivers).map((i, n) => ({ ...i, icon: n ? "water" : null })),
    };
    expect(lookMet(s, look)).toBe(false);
  });
  test("layouts that draw their own visual still meet it", () => {
    const full = { ...rivers, items: items(rivers).map((i) => ({ ...i, icon: "water" })) };
    expect(lookMet(full, look)).toBe(true);
    expect(lookMet(routeIconMisses(rivers).slide, look)).toBe(true);
    const panel = { ...rivers, panel: { picture: { shows: "a river" } } };
    expect(lookMet(panel, look)).toBe(true);
    const split = {
      template: "split-compare",
      sides: [{ title: "a", picture: { shows: "x" } }, { title: "b" }],
    };
    expect(lookMet(split, look)).toBe(true);
    expect(lookMet({ template: "split-compare", sides: [{ title: "a" }] }, look)).toBe(false);
    expect(lookMet(rivers, { kind: "none" })).toBe(true);
  });
});

describe("review fixes", () => {
  const over = (path: string, chars: number, room: number, clipped = false) => ({
    path,
    chars,
    room,
    clipped,
  });
  test("1: a routed row the layout would drop members from does not fit", () => {
    expect(fitsNoWorse({ overs: [], tooMany: false }, { overs: [], tooMany: true })).toBe(false);
    expect(fitsNoWorse({ overs: [], tooMany: false }, { overs: [], tooMany: false })).toBe(true);
  });
  test("2: an over that worsens or clips after routing does not fit; one unchanged does", () => {
    const was = { overs: [over("items.0.text", 60, 50)], tooMany: false };
    expect(fitsNoWorse(was, { overs: [over("items.0.text", 60, 40)], tooMany: false })).toBe(false);
    expect(fitsNoWorse(was, { overs: [over("items.0.text", 60, 50, true)], tooMany: false })).toBe(
      false,
    );
    expect(fitsNoWorse(was, { overs: [over("items.1.text", 30, 20)], tooMany: false })).toBe(false);
    expect(fitsNoWorse(was, { overs: [over("items.0.text", 60, 50)], tooMany: false })).toBe(true);
  });
  test("3: a full row of scoped icons meets its look in its subject", () => {
    const roots = resolveIcon("roots", { subject: "science" });
    expect(roots).not.toBeNull();
    const s = { ...rivers, items: items(rivers).map((i) => ({ ...i, icon: "roots" })) };
    expect(lookMet(s, { kind: "picture" }, "Science Plants")).toBe(true);
    expect(lookMet(s, { kind: "picture" })).toBe(false);
  });
  test("4: a hinge keeps its options' own icons and reports only the real misses", () => {
    const s: S = {
      template: "hinge",
      heading: "Which part?",
      options: [
        { text: "Leaves", icon: "leaf" },
        { text: "The stem", icon: null },
      ],
    };
    const r = routeIconMisses(s, { subject: "Science" });
    expect(r.route?.to).toBe("catalogue");
    expect(r.route?.misses.map((m) => m.slot)).toEqual(["option.1"]);
    expect((r.slide.options as S[])[0]?.icon).toBe("leaf");
    const lacking: S = {
      ...s,
      options: [
        { text: "Leaves", icon: "leaf" },
        { text: "Abrasion", icon: null },
      ],
    };
    expect(routeIconMisses(lacking).route).toMatchObject({
      to: "none",
      misses: [{ slot: "option.1", name: "Abrasion" }],
    });
  });
  test("minor: a proof with a null among its icons is not met; pic needs a shows phrase", () => {
    const s: S = {
      template: "myth",
      heading: "x",
      myth: { claim: "c", fact: "f", proof: { line: "Leaves make food.", icons: ["leaf", null] } },
    };
    expect(routeIconMisses(s).route?.to).toBe("picture");
    const bare = { ...rivers, items: items(rivers).map((i) => ({ ...i, picture: { alt: "x" } })) };
    expect(drawsOwnVisual(bare)).toBe(false);
  });
});

test("y8 photosynthesis s8 (11 Nov): a row picture's ask carries the slide's heading", () => {
  // The recorded panel list: "Respiration" has no catalogue icon, so each row asks a picture.
  const s: S = {
    template: "panel-list",
    heading: "How plants use glucose",
    panel: null,
    items: [
      {
        name: "Respiration",
        text: "Glucose is used in respiration to release energy.",
        icon: null,
        picture: null,
      },
      {
        name: "Cellulose",
        text: "Glucose is used to make cellulose for cell walls.",
        icon: null,
        picture: null,
      },
      {
        name: "Starch",
        text: "Glucose is converted into starch to store energy.",
        icon: null,
        picture: null,
      },
    ],
  };
  const r = routeIconMisses(s, { around: "Photosynthesis" });
  // As recorded (`icon-routed`, to picture, misses row.0 to row.2).
  expect(r.route?.to).toBe("picture");
  expect((items(r.slide)[0]?.picture as S | undefined)?.shows).toBe(
    "Respiration: Glucose is used in respiration to release energy (How plants use glucose)",
  );
});
