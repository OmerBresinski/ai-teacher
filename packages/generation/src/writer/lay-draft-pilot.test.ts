import { describe, expect, test } from "bun:test";
import { PENDING_ICON } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import { peekPartial } from "./draft";
import { shuffleHinge } from "./fixes";
import FIX from "./fixtures/pilot-draft-slides.json" with { type: "json" };
import { iconsFromNames, keepSidePictures, layDraft } from "./lay-draft";
import { materialise, stableIdPrefix } from "./materialise";

/*
 * Draft mode for the pilot layouts (items-row, panel-list, split-compare; stream sim 13 Oct, Greg:
 * "adaptive reflow while streaming is wanted; vanishing elements are not"). Real Sol 6.1 slides
 * are fed through the draft path prefix by prefix:
 * - a picture slot, once shown, never vanishes while the slide is written;
 * - the whole slide through the draft path is the closed slide, geometry and ids, so the
 *   hand-over moves and remounts nothing;
 * - every id a draft shows is an id the closed slide keeps.
 */

type S = Record<string, unknown>;
type El = { id: string; type: string; x: number; y: number; w: number; h: number; children?: El[] };
const flat = (els: El[]): El[] => els.flatMap((e) => [e, ...flat(e.children ?? [])]);
const box = (e: El) =>
  `${e.type} ${Math.round(e.x)},${Math.round(e.y)},${Math.round(e.w)},${Math.round(e.h)}`;

const theme = getTheme("paper");
const brief = {
  id: "t",
  topic: "t",
  subject: "science",
  yearGroup: "Year 6",
  year: 6,
  keyStage: "ks2",
  theme: "paper",
  readingLevel: "",
  language: "en-GB",
  durationMin: 60,
  exitTicketOnSlides: true,
} as S;
const INDEX = 5;
const ctxOf = (flow: S[]) =>
  ({
    brief,
    theme,
    stage: "ks2",
    index: INDEX,
    plan: { flow: flow.map((f) => ({ ...f, slide: INDEX + 1 })), slides: [] },
  }) as never;

const CASES = Object.entries(FIX as Record<string, { slide: S; flow: S[] }>);

describe("pilot layouts in draft mode", () => {
  for (const [name, { slide, flow }] of CASES) {
    const ctx = ctxOf(flow);
    const closed = materialise(slide, {
      ...(ctx as object),
      visual: () => ({ status: "pending" }),
    } as never).slide.elements as unknown as El[];
    const text = JSON.stringify(slide);
    const drafts: El[][] = [];
    for (let at = 20; at <= text.length; at += 20) {
      const p = peekPartial(text.slice(0, at));
      const v = p?.value as S | undefined;
      // `SlideDrafts` sends nothing while the template's own name is still arriving.
      if (!v || typeof v.template !== "string" || p?.open?.[0] === "template") continue;
      const { template, ...fields } = v;
      const laid = layDraft(
        { template, fields, ...(p?.open ? { open: p.open } : {}) },
        ctx,
        new Map(),
        "KS2",
      );
      if (laid) drafts.push(laid.elements as unknown as El[]);
    }

    test(`${name}: the whole slide through the draft path is the closed slide, ids and boxes`, () => {
      const { template, ...fields } = slide;
      const whole = layDraft({ template: template as string, fields }, ctx, new Map(), "KS2");
      const a = flat(whole?.elements as unknown as El[]).map((e) => `${e.id} ${box(e)}`);
      const b = flat(closed).map((e) => `${e.id} ${box(e)}`);
      expect(a).toEqual(b);
      expect(flat(closed).every((e) => e.id.startsWith(stableIdPrefix(INDEX)))).toBe(true);
    });

    test(`${name}: a picture slot never vanishes while the slide is written`, () => {
      expect(drafts.length).toBeGreaterThan(3);
      const seen = new Set<string>();
      for (const d of drafts) {
        const pics = new Set(
          flat(d)
            .filter((e) => e.type === "image")
            .map((e) => e.id),
        );
        for (const id of seen) if (/picture/i.test(id)) expect(pics.has(id)).toBe(true);
        for (const id of pics) seen.add(id);
      }
    });

    test(`${name}: every id a draft shows is kept by the closed slide`, () => {
      const kept = new Set(flat(closed).map((e) => e.id));
      const extra = drafts.flatMap((d) =>
        flat(d)
          .map((e) => e.id)
          .filter((id) => !kept.has(id)),
      );
      expect([...new Set(extra)]).toEqual([]);
    });
  }
});

describe("keepSidePictures", () => {
  const pic = { shows: "a heart", must_see: ["heart"], subject: "generic" };
  test("a side whose picture has not arrived holds the first side's slot", () => {
    const s = { template: "split-compare", sides: [{ title: "A", picture: pic }, { title: "B" }] };
    expect((keepSidePictures(s).sides as S[])[1]?.picture).toEqual(pic);
  });
  test("a half-written picture (no `shows` yet) holds the slot too", () => {
    const s = {
      template: "split-compare",
      sides: [
        { title: "A", picture: pic },
        { title: "B", picture: { kind: "labelled-d" } },
      ],
    };
    expect((keepSidePictures(s).sides as S[])[1]?.picture).toEqual(pic);
  });
  test("an explicit null is the writer's choice and stays", () => {
    const s = {
      template: "split-compare",
      sides: [
        { title: "A", picture: pic },
        { title: "B", picture: null },
      ],
    };
    expect((keepSidePictures(s).sides as S[])[1]?.picture).toBeNull();
  });
  test("no side with a picture yet: nothing is reserved", () => {
    const s = { template: "split-compare", sides: [{ title: "A" }, { title: "B" }] };
    expect(keepSidePictures(s)).toBe(s);
  });
});

/*
 * Icons while a row streams (Greg 14 Oct, option "on name" with: no numbers while icons are inbound,
 * no placeholder drawing, icons fade in). Two icon rows written for the sim (the heart's real labels;
 * the volcano hazards in the writer's field order name, text, icon) and the fixtures' no-icon row
 * (Arteries..., `icon: null`) are fed prefix by prefix through the draft path.
 */
const ICON_ROWS: Record<string, S> = {
  "items-row heart": {
    template: "items-row",
    heading: "Three parts working together",
    items: [
      {
        name: "Heart",
        text: "A strong muscle that pumps blood all around your body.",
        icon: "heart",
      },
      { name: "Blood", text: "Carries oxygen and food to every part of you.", icon: "blood" },
      {
        name: "Blood vessels",
        text: "Tubes that carry blood to and from the heart.",
        icon: "blood vessel",
      },
    ],
  },
  "panel-list volcano": {
    template: "panel-list",
    heading: "Volcanic hazards",
    items: [
      { name: "Lava", text: "Molten rock that burns everything in its path.", icon: "lava" },
      {
        name: "Ash cloud",
        text: "Fine rock dust that blocks the sun and the lungs.",
        icon: "ash cloud",
      },
      {
        name: "Volcanic gas",
        text: "Invisible gases that can poison people nearby.",
        icon: "volcanic gas",
      },
    ],
  },
};
type Face = { numbers: number; icons: string[]; ids: string[] };
const faceOf = (els: El[]): Face => {
  const all = flat(els) as (El & { name?: string; doc?: unknown })[];
  const isIcon = (e: { name?: string }) => e.name === "Picture" || e.name === "Row icon";
  return {
    numbers: all.filter(
      (e) => e.name === "Number" || (e.name === "Row circle" && e.doc !== undefined),
    ).length,
    icons: all.filter(isIcon).map((e) => e.id),
    ids: all.map((e) => e.id),
  };
};
const draftsOf = (slide: S, ctx: never) => {
  const text = JSON.stringify(slide);
  const out: { at: number; v: S; face: Face; els: El[] }[] = [];
  for (let at = 10; at <= text.length; at += 10) {
    const p = peekPartial(text.slice(0, at));
    const v = p?.value as S | undefined;
    if (!v || typeof v.template !== "string" || p?.open?.[0] === "template") continue;
    const { template, ...fields } = v;
    const laid = layDraft(
      { template, fields, ...(p?.open ? { open: p.open } : {}) },
      ctx,
      new Map(),
      "KS2",
    );
    if (laid)
      out.push({
        at,
        v,
        face: faceOf(laid.elements as unknown as El[]),
        els: laid.elements as unknown as El[],
      });
  }
  return out;
};

describe("icons while a row streams", () => {
  for (const [name, slide] of Object.entries(ICON_ROWS)) {
    const ctx = ctxOf([]);
    const drafts = draftsOf(slide, ctx);
    const closed = faceOf(
      materialise(slide, { ...(ctx as object), visual: () => ({ status: "pending" }) } as never)
        .slide.elements as unknown as El[],
    );

    test(`${name}: the closed row has an icon on every item`, () => {
      expect(closed.icons).toHaveLength(3);
      expect(closed.numbers).toBe(0);
    });

    test(`${name}: no draft ever shows a number while icons are inbound`, () => {
      expect(drafts.length).toBeGreaterThan(10);
      for (const d of drafts) expect(d.face.numbers).toBe(0);
    });

    test(`${name}: icons arrive one by one, each as its item's name closes, and never leave`, () => {
      const seen = new Set<string>();
      let counts: number[] = [];
      for (const d of drafts) {
        for (const id of seen) expect(d.face.icons).toContain(id);
        for (const id of d.face.icons) seen.add(id);
        counts.push(d.face.icons.length);
      }
      counts = [...new Set(counts)];
      expect(counts).toEqual([0, 1, 2, 3]);
      // Item 2's icon is there before item 2's words have started.
      const two = drafts.find((d) => d.face.icons.length === 2);
      const item2 = ((two?.v.items as S[]) ?? [])[1] ?? {};
      expect(typeof item2.text === "string" && (item2.text as string).length > 10).toBe(false);
    });

    test(`${name}: when an icon lands nothing else moves`, () => {
      for (let k = 1; k < drafts.length; k++) {
        const a = drafts[k - 1] as (typeof drafts)[number];
        const b = drafts[k] as (typeof drafts)[number];
        if (b.face.icons.length === a.face.icons.length) continue;
        if (
          JSON.stringify((a.v.items as S[])?.length) !== JSON.stringify((b.v.items as S[])?.length)
        )
          continue;
        const faces = (els: El[]) =>
          flat(els)
            .filter((e) => /Circle|Row_circle/.test(e.id))
            .map((e) => `${e.id} ${box(e)}`);
        expect(faces(b.els)).toEqual(faces(a.els));
      }
    });
  }

  test("no-icon row (`icon: null`): no draft ever shows an icon, and numbers come once it is declared", () => {
    const { slide, flow } = (FIX as Record<string, { slide: S; flow: S[] }>)["items-row"] as {
      slide: S;
      flow: S[];
    };
    const drafts = draftsOf(slide, ctxOf(flow));
    expect(drafts.length).toBeGreaterThan(10);
    for (const d of drafts) {
      expect(d.face.icons).toEqual([]);
      const declared = ((d.v.items as S[]) ?? []).some((it) => it && it.icon === null);
      if (!declared) expect(d.face.numbers).toBe(0);
    }
    expect(drafts.at(-1)?.face.numbers).toBeGreaterThan(0);
  });

  test("unit: unknown holds empty faces; a half-written name or icon never draws", () => {
    const row = (items: S[]) => ({ template: "items-row", items });
    expect(
      (iconsFromNames(row([{ name: "Heart" }]), ["items", 0, "name"]).items as S[])[0]?.icon,
    ).toBe(PENDING_ICON);
    expect((iconsFromNames(row([{ name: "Heart", text: "x" }])).items as S[])[0]?.icon).toBe(
      PENDING_ICON,
    );
    const inbound = row([{ name: "Heart", text: "x", icon: "he" }, { name: "Blood" }]);
    const got = iconsFromNames(inbound, ["items", 0, "icon"]).items as S[];
    expect(got[0]?.icon).toBe("Heart");
    expect(got[1]?.icon).toBe("Blood");
    const half = iconsFromNames(
      row([{ name: "Heart", text: "x", icon: "heart" }, { name: "Blo" }]),
      ["items", 1, "name"],
    ).items as S[];
    expect(half[0]?.icon).toBe("heart");
    expect(half[1]?.icon).toBe(PENDING_ICON);
    expect(iconsFromNames(row([{ name: "Heart", icon: null }]))).toEqual(
      row([{ name: "Heart", icon: null }]),
    );
  });
});

test("a hinge draft draws its options in the closed slide's shuffled order once its key arrives", () => {
  const hinge = {
    template: "hinge",
    heading: "Choose the defining feature",
    stem: "An artery always carries blood…",
    options: ["away from the heart", "towards the heart", "rich in oxygen"],
    correct: 1,
  };
  const ctx = ctxOf([]) as never as Parameters<typeof layDraft>[1] & {
    brief: { id: string };
    index: number;
  };
  const words = (els: unknown) =>
    JSON.stringify(els).match(/away from the heart|towards the heart|rich in oxygen/g);
  const { template, ...fields } = hinge;
  const laid = layDraft({ template, fields }, ctx, new Map(), "KS2");
  const closed = materialise(shuffleHinge(hinge, `${ctx.brief.id}:${ctx.index}:${hinge.stem}`), {
    ...ctx,
    visual: () => ({ status: "pending" }),
  });
  expect(words(laid?.elements)).toEqual(words(closed.slide.elements));
});
