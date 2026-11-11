import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTheme } from "@tj/slides/themes";
import { GOLD_FIELDS, GOLD_MANIFEST, type GoldEntry } from "./gold-manifest";
import { materialise } from "./materialise";
import { offeredLayouts, PILOT_PACK_LIVE, pilotRequest } from "./pilot-pack";

type S = Record<string, unknown>;
const TEMPLATES = join(import.meta.dir, "../../../slides/src/templates");

/** The entry's sample laid through the real path (materialise: toInput, then layoutTemplate). */
function lay(e: GoldEntry) {
  const stage = e.sample.stage ?? "ks2";
  const theme = getTheme("studio", stage);
  const slides = e.sample.slides ?? [
    { template: "title" },
    { template: "objectives" },
    e.sample.slide,
  ];
  const index = e.sample.index ?? (e.sample.slides ? slides.indexOf(e.sample.slide) : 2);
  const ctx = {
    brief: { subject: "science", topic: "plants", stage },
    theme,
    stage,
    index,
    plan: {
      slides,
      objectives: [{ teacher: "Name the parts", pupil: "name the parts of a plant" }],
    },
    visual: (k: string) => e.sample.visual?.[k] ?? { status: "failed" },
    ...(e.sample.draft ? { draft: true } : {}),
  } as unknown as Parameters<typeof materialise>[1];
  return materialise(e.sample.slide, ctx);
}

/** Every word the laid slide shows. */
const wordsOn = (els: unknown): string => {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v))
        k === "text" && typeof x === "string" ? out.push(x) : walk(x);
  };
  walk(els);
  return out.join(" ");
};

const name = (e: GoldEntry) => `${e.layout}: ${e.variant}`;

describe("gold manifest: every new slide is drawn by its gold", () => {
  for (const e of GOLD_MANIFEST) {
    test(name(e), () => {
      const m = lay(e);
      const right =
        m.drawer === e.gold && (e.shows ?? []).every((w) => wordsOn(m.slide.elements).includes(w));
      if (e.gold && !e.todo) {
        expect(m.drawer).toBe(e.gold);
        for (const w of e.shows ?? []) expect(wordsOn(m.slide.elements)).toContain(w);
      } else if (e.todo) {
        // Still to route: the guard lists it, and fails once it is right so the todo is removed.
        expect(right, `${name(e)} is right now: remove its todo`).toBe(false);
      } else {
        // A known gap (or a path still to route): pinned to the drawer named, so a change is seen.
        expect(e.gold ? e.todo : e.gap).toBeTruthy();
        expect(m.drawer).toBe(e.legacy as NonNullable<typeof m.drawer>);
      }
    });
  }

  test("every layout the live pack offers has an entry, and every gap says why", () => {
    const offered = new Set<string>(["title", "objectives"]);
    for (const ks of ["KS1", "KS2", "KS3"])
      for (const l of offeredLayouts(pilotRequest(PILOT_PACK_LIVE, ks, {}, (s) => s).schema as S))
        offered.add(l);
    const listed = new Set(GOLD_MANIFEST.map((e) => e.layout));
    expect([...offered].filter((l) => !listed.has(l))).toEqual([]);
    for (const e of GOLD_MANIFEST) {
      if (!e.gold) expect(e.gap, name(e)).toBeTruthy();
      if (e.gold) expect(e.gap, name(e)).toBeUndefined();
    }
  });

  test("the known gaps and paths still to route (the guard's list)", () => {
    const list = GOLD_MANIFEST.filter((e) => !e.gold || e.todo).map(
      (e) => `${e.todo ? "TODO" : "GAP"} ${name(e)} -> ${e.legacy}`,
    );
    console.log(list.join("\n"));
    expect(list.length).toBeGreaterThan(0);
  });
});

describe("gold manifest: every field a gold reads is written, set by code, or a known gap", () => {
  const defs: { layout: string; props: string[] }[] = [];
  for (const ks of ["KS1", "KS2", "KS3"]) {
    const schema = pilotRequest(PILOT_PACK_LIVE, ks, {}, (s) => s).schema as S;
    for (const d of Object.values((schema.$defs ?? {}) as Record<string, S>)) {
      const p = (d.properties ?? {}) as Record<string, S>;
      const t = (p.template?.enum ?? []) as string[];
      for (const layout of t) defs.push({ layout, props: Object.keys(p) });
    }
  }
  for (const [drawer, g] of Object.entries(GOLD_FIELDS))
    test(drawer, () => {
      const src = g.files.map((f) => readFileSync(join(TEMPLATES, f), "utf8")).join("\n");
      const read = new Set<string>();
      for (const m of src.matchAll(/\binput\??\.([a-zA-Z]+)/g)) read.add(m[1] as string);
      for (const m of src.matchAll(/const \{([^}]*)\} = input\b/g))
        for (const k of (m[1] as string).split(","))
          if (!k.trim().startsWith("...")) read.add(k.split(":")[0]?.trim() ?? "");
      read.delete("");
      expect([...read].filter((k) => !(k in g.fields)).sort()).toEqual([]);
      for (const [field, from] of Object.entries(g.fields)) {
        expect(from, `${drawer}.${field}`).toMatch(/^(schema|code|gap):/);
        if (!from.startsWith("schema:")) continue;
        const path = from.slice(7);
        const has = defs.some((d) => g.layouts.includes(d.layout) && d.props.includes(path));
        expect(has, `${drawer}.${field} from schema ${path}`).toBe(true);
      }
    });
});

test("panel-list's pie (panel.shares) reaches the gold", async () => {
  const { toInput } = await import("./materialise");
  const e = GOLD_MANIFEST.find((x) => x.layout === "panel-list") as GoldEntry;
  const ctx = {
    brief: { subject: "science", topic: "plants" },
    theme: getTheme("studio", "ks2"),
    stage: "ks2",
    index: 2,
    plan: { slides: [] },
    visual: () => ({ status: "failed" }),
  } as unknown as Parameters<typeof toInput>[1];
  expect((toInput(e.sample.slide, ctx) as { panel?: unknown }).panel).toEqual({ shares: [3, 1] });
});
