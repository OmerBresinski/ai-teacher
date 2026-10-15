// Round 9 (regression audit cause 2a): the writer's fit, in characters per field, measured by the
// renderer. For each key-stage group, writer layout and way of filling it (variant), every text
// field gets the most characters with which the slide lays out with nothing over (layoutTemplate's
// own `over`), on every theme and stage of the group, with every field at its limit at once: the
// heading at its two-line limit, the instruction at one line, the lead and items together. One table
// feeds the menu's Fits lines (make_menu.py) and the strict schema's limits (make_schema.py).
// bun packages/slides/src/templates/fit-table.ts [out.json]   (default fit.json)
import { writeFileSync } from "node:fs";
import { countLines } from "../text-measure";
import { getTheme } from "../themes";
import { TEMPLATE_DOCS } from "./capacity";
import { G, layoutTemplate, type TemplateInput, templateScale } from "./index";
import { GROUPS } from "./slot-limits";

const OUT = process.argv[2] ?? "fit.json";
type Group = keyof typeof GROUPS;
type Doc = (typeof TEMPLATE_DOCS)[number];
type Variant = Doc["variants"][number];

/** Writer layouts and the renderer templates each one becomes (twins share a menu line: the smaller fit wins). */
export const WRITER: Record<string, string[]> = {
  title: ["title"],
  "visual-text": ["picture-text", "diagram-text"],
  "big-visual": ["big-picture", "big-diagram"],
  "picture-sequence": ["picture-sequence"],
  compare: ["compare"],
  steps: ["steps"],
  "equation-hero": ["equation-hero"],
  discussion: ["discussion"],
  explain: ["explain"],
  hinge: ["hinge"],
  "question-set": ["question-set"],
  practice: ["practice"],
  "exit-ticket": ["exit-ticket"],
};
/** Fixed-length parts the variants are measured with (a key card's label, a compare card's label). */
const KEY_LABEL = 16;
const COLUMN_LABEL = 12;
const FORMULA = 16;

const WORDS =
  "Young animals grow and change as they get older and many of them look like their parents while others change shape completely before they become adults that can have young of their own again";
/** Real words cut at a word boundary to at most `n` characters (each item starts at its own word). */
export const sample = (n: number, seed = 0) => {
  const w = WORDS.split(" ");
  const rot = [...w.slice(seed % w.length), ...w.slice(0, seed % w.length)];
  let out = "";
  for (const x of [...rot, ...rot, ...rot]) {
    const next = out ? `${out} ${x}` : x;
    if (next.length > n) break;
    out = next;
  }
  return (out || "Word").charAt(0).toUpperCase() + (out || "Word").slice(1);
};
const PH = { photo: "x", aspect: 4 / 3 };
const DIA = { diagram: { kind: "cycle", alt: "c", steps: ["Egg", "Chick", "Hen"] } };

/** The slide `doc`/`v` with every text field at its limit: items and lead `n`, heading `h`, instruction `ins`. */
/**
 * Round 9 calibration: which field is long. "all" sets every field at n at once (the joint fit);
 * "first" sets the first item at n and the rest at REST; "lead" the lead at n, items at REST. The
 * single-field ceilings come from "first" and "lead".
 */
let LONG: "all" | "first" | "lead" = "all";
const REST = 16;
function input(doc: Doc, v: Variant, n0: number, h: number, ins: number): TemplateInput {
  const n = LONG === "all" ? n0 : REST;
  const leadN = LONG === "first" ? REST : n0;
  const fig = v.figure === "photo" ? PH : v.figure === "diagram" ? DIA : undefined;
  const items = (k: number) =>
    Array.from({ length: k }, (_, i) => sample(i === 0 && LONG === "first" ? n0 : n, i * 3 + 1));
  const base = { template: doc.id, heading: sample(h, 7) } as TemplateInput;
  const c = v.counts as Record<string, number>;
  switch (doc.id) {
    case "title":
      return { ...base, lead: sample(leadN), ...(fig ? { figure: fig } : {}) } as TemplateInput;
    case "explain":
    case "picture-text":
    case "diagram-text":
      return {
        ...base,
        lead: sample(leadN),
        points: v.keyCards
          ? items(c.points ?? 1).map((text, i) => ({ label: sample(KEY_LABEL, i * 5), text }))
          : items(c.points ?? 0),
        ...(fig ? { figure: fig } : {}),
      } as TemplateInput;
    case "big-picture":
    case "big-diagram":
    case "discussion":
      return { ...base, lead: sample(leadN), ...(fig ? { figure: fig } : {}) } as TemplateInput;
    case "picture-sequence":
      return {
        ...base,
        sequence: items(c.sequence ?? 3).map((caption) => ({ caption, figure: PH })),
      } as TemplateInput;
    case "compare":
      return {
        ...base,
        columns: items(c.columns ?? 2).map((text, i) => ({
          label: sample(COLUMN_LABEL, i),
          text,
          ...(fig ? { figure: PH } : {}),
        })),
      } as TemplateInput;
    case "steps":
      return {
        ...base,
        points: items(c.points ?? 3),
        ...(fig ? { figure: fig } : {}),
      } as TemplateInput;
    case "equation-hero":
      return {
        ...base,
        formula: sample(FORMULA),
        points: items(c.points ?? 2),
        ...(fig ? { figure: fig } : {}),
      } as TemplateInput;
    case "hinge":
      return {
        ...base,
        stem: sample(Math.round(n * 1.6)),
        options: items(c.options ?? 4),
      } as TemplateInput;
    default:
      return {
        ...base,
        questions: items(c.questions ?? 3),
        ...(ins ? { instruction: sample(ins, 11) } : {}),
        ...(fig ? { figure: fig } : {}),
      } as TemplateInput;
  }
}

/**
 * Round 9 calibration: what ships clean, the renderer's ladder included (a column may step down to
 * the small body size before it overflows). Round 7 shipped 1 overflow while half its slides broke
 * the full-size fit, so the full-size measure (fit-first) said about half the room the slides have.
 */
const LADDER = true;
/** Whether the slide lays out with nothing over on every theme and stage of `g`. */
const clean = (g: Group, make: () => TemplateInput) =>
  GROUPS[g].themes.every((th) =>
    GROUPS[g].stages.every((st) => {
      const lay = (fullSize: boolean) => {
        try {
          return layoutTemplate(make(), getTheme(th), st as never, { fullSize }).over.length === 0;
        } catch {
          return false;
        }
      };
      return lay(!LADDER);
    }),
  );
/**
 * The largest even n in [2, max] such that every even length up to n fits: a cap the writer can trust
 * for any length under it (the renderer is not monotone: a longer item can wrap into a better break).
 */
const largest = (ok: (n: number) => boolean, max = 240) => {
  let best = 0;
  for (let n = 2; n <= max && ok(n); n += 2) best = n;
  return best;
};
/** One line of `role` text in a column `w` wide, on every theme and stage of `g` (the renderer's measure). */
const oneLine = (g: Group, w: number, role: "body" | "heading" = "body") =>
  Math.min(
    ...GROUPS[g].themes.flatMap((th) =>
      GROUPS[g].stages.map((st) => {
        const theme = getTheme(th);
        const s = templateScale(theme, st as never);
        return largest(
          (n) =>
            countLines(
              sample(n, 11),
              role,
              theme,
              w,
              role === "body" ? theme.weights.body : theme.weights.heading,
              s[role],
            ) <= 1,
          160,
        );
      }),
    ),
  );

/**
 * Hinge cards (HEART1 R3 s6): `clean` lets the options step down a size and wrap freely, so the
 * table offered 3-across KS2 options 100 characters while 37 already wrapped to 4 lines in a card
 * half empty. A card reads well when its option stays at full body size in at most this many lines.
 */
export const HINGE_CARD_LINES = 3;
/** The most lines any option card takes, on every theme and stage of `g` (Infinity: over, or stepped down). */
export function hingeCardLines(
  g: Group,
  options: string[],
  stem: string,
  part = "Option text",
): number {
  let worst = 0;
  for (const th of GROUPS[g].themes)
    for (const st of GROUPS[g].stages) {
      const theme = getTheme(th);
      const full = templateScale(theme, st as never).body;
      const r = layoutTemplate(
        { template: "hinge", heading: sample(40, 7), stem, options } as TemplateInput,
        theme,
        st as never,
      );
      if (r.over.length) return Number.POSITIVE_INFINITY;
      for (const e of r.slide.elements) {
        if (e.name !== part || e.type !== "text") continue;
        const fs = e.style?.fontSize ?? full;
        if (fs < full) return Number.POSITIVE_INFINITY;
        worst = Math.max(worst, Math.round(e.h / (fs * (e.style?.lineHeight ?? 1.4))));
      }
    }
  return worst;
}
/**
 * The longest option (characters, cut at a word) that every one of `k` cards holds at full size in
 * `HINGE_CARD_LINES` lines beside a stem of `stem` characters: the writer's true option budget.
 */
export const hingeCardFit = (g: Group, k: number, stem: number) =>
  largest(
    (n) =>
      hingeCardLines(
        g,
        Array.from({ length: k }, (_, i) => sample(n, i * 3 + 1)),
        sample(stem),
      ) <= HINGE_CARD_LINES,
  );
/** The stem's lines: one short question, at most two lines across the slide. */
export const HINGE_STEM_LINES = 2;
/** The longest stem that stays at full size in HINGE_STEM_LINES lines beside short options. */
export const hingeStemFit = (g: Group) =>
  largest(
    (n) =>
      hingeCardLines(g, [sample(REST, 1), sample(REST, 4)], sample(n), "Stem") <= HINGE_STEM_LINES,
  );
/** The hinge option counts the writer may use (capacity.ts: 2 to 4 options). */
export const HINGE_OPTIONS = [2, 3, 4] as const;
/**
 * The hinge caps by card (HEART1 R3 s6), the generator for `hinge-cards.gen.json`: per group the
 * stem's cap, then each option count's longest option beside a stem at that cap. `measureFit`
 * stays the lab's table (lab-tables.test.ts pins it); a writer opts in to these caps
 * (`fitTable({ hingeCards: true })` in @tj/generation), so a bundle that does not keeps its numbers.
 */
export function measureHingeCards() {
  const groups: Record<string, { stem: number; options: Record<string, number> }> = {};
  for (const g of Object.keys(GROUPS) as Group[]) {
    const stem = hingeStemFit(g);
    groups[g] = {
      stem,
      options: Object.fromEntries(HINGE_OPTIONS.map((k) => [String(k), hingeCardFit(g, k, stem)])),
    };
  }
  return {
    note: `generated by packages/slides/src/templates/fit-table.ts --hinge-cards: each option at full body size in ${HINGE_CARD_LINES} lines, the stem in ${HINGE_STEM_LINES}, on every theme of the group; do not edit`,
    groups,
  };
}

const FIELDS: Record<string, string[]> = {
  title: ["lead"],
  "visual-text": ["lead", "points"],
  "big-visual": ["lead"],
  "picture-sequence": ["captions"],
  compare: ["column text"],
  steps: ["points"],
  "equation-hero": ["points"],
  discussion: ["lead"],
  explain: ["lead", "points"],
  hinge: ["options"],
  "question-set": ["questions"],
  practice: ["questions"],
  "exit-ticket": ["questions"],
};
const QUESTIONS = new Set(["question-set", "practice", "exit-ticket"]);
/** Round 9: the fewest characters a question, step or working line needs to say anything. */
const MIN_ITEM = 30;
const STARVE = new Set([...QUESTIONS]);

export function measureFit() {
  const out: Record<string, unknown> = {};
  for (const g of Object.keys(GROUPS) as Group[]) {
    const byId = new Map(TEMPLATE_DOCS.map((d) => [d.id as string, d]));
    const explain = byId.get("explain") as Doc;
    // Round 9 calibration: the heading band holds two lines; the cap is the longest heading the
    // layout keeps clean (round 7 headings over one line shipped clean).
    const heading = largest(
      (h) => clean(g, () => input(explain, explain.variants[0] as Variant, 10, h, 0)),
      160,
    );
    const headingOne = Math.min(heading, oneLine(g, G.width, "heading"));
    const layouts: Record<string, unknown> = {};
    for (const [w, ids] of Object.entries(WRITER)) {
      // Round 9 (prompt audit 7): an exit ticket takes a figure like the other question layouts
      // (the renderer lays it out the same way); its doc lists no such way, so it is measured here.
      const docs = ids.map((id) => {
        const d = byId.get(id) as Doc;
        if (id !== "exit-ticket" || d.variants.some((v) => v.figure)) return d;
        const fig = (byId.get("practice") as Doc).variants.filter((v) => v.figure);
        return { ...d, variants: [...d.variants, ...fig] } as Doc;
      });
      const labels = [...new Set(docs.flatMap((d) => d.variants.map((v) => v.label)))];
      const variants = labels.map((label) => {
        const vs = docs.flatMap((d) =>
          d.variants.filter((v) => v.label === label).map((v) => [d, v] as const),
        );
        const figure = !!vs[0]?.[1].figure;
        // Round 9 (prompt audit 7): a way that only fits under a one-line heading (2 compare
        // cards with pictures: the picture falls under 4:3) is measured, and offered, with one.
        let hd = heading;
        const fitAt = (h: number) =>
          Math.min(...vs.map(([d, v]) => largest((k) => clean(g, () => input(d, v, k, h, 0)))));
        if (fitAt(heading) < MIN_ITEM)
          for (let h = headingOne; h >= 12; h -= 4)
            if (fitAt(h) >= Math.min(MIN_ITEM, 20)) {
              hd = h;
              break;
            }
        // Round 9 (coordinator): a question slide with a figure whose questions would get under
        // MIN_ITEM characters with an instruction line has no instruction line (KS1-2 held 22-24).
        const fit = (insN: number) =>
          Math.min(...vs.map(([d, v]) => largest((k) => clean(g, () => input(d, v, k, hd, insN)))));
        const ins0 = QUESTIONS.has(w) ? oneLine(g, figure ? G.left.w : 760) : 0;
        const n0 = fit(ins0);
        const noIns = QUESTIONS.has(w) && figure && n0 < MIN_ITEM && fit(0) >= MIN_ITEM;
        const ins = noIns ? 0 : ins0;
        const nFit = noIns ? fit(0) : n0;
        // A way that leaves its items too little room to say anything is not offered (the
        // layout, not the text, is the problem); the writer picks another way of filling it.
        const n = STARVE.has(w) && nFit < MIN_ITEM ? 0 : nFit;
        // Round 9 calibration: one field long with the rest short (its ceiling), and the joint total
        // (every field at n at once) as the layout's character budget.
        const ceilingOf = (insN: number) =>
          Math.min(
            ...vs.flatMap(([d, v]) =>
              (["first", "lead"] as const).map((mode) => {
                LONG = mode;
                const r = largest((k) => clean(g, () => input(d, v, k, hd, insN)));
                LONG = "all";
                return r || 240;
              }),
            ),
          );
        // A question slide without its instruction line has that line's room for its questions.
        const bare = ins
          ? Math.min(...vs.map(([d, v]) => largest((k) => clean(g, () => input(d, v, k, hd, 0)))))
          : 0;
        const v0 = vs[0]?.[1] as Variant;
        return {
          label: QUESTIONS.has(w)
            ? label.replace("with picture", "with a figure")
            : label.replace("with figure", "with a picture or diagram"),
          counts: v0.counts,
          figure,
          keyCards: !!v0.keyCards,
          chars: n,
          ...(ins ? { instruction: ins, charsNoInstruction: bare } : {}),
          ceiling: n ? ceilingOf(ins) : 0,
          ...(noIns ? { noInstruction: true } : {}),
          ...(hd !== heading ? { headingMax: hd } : {}),
          ...(ins ? { ceilingNoInstruction: bare ? ceilingOf(0) : 0 } : {}),
          ...(w === "hinge" && n ? { stem: Math.round(n * 1.6) } : {}),
          ...(v0.keyCards ? { keyLabel: KEY_LABEL } : {}),
          ...(w === "compare" ? { columnLabel: COLUMN_LABEL } : {}),
        };
      });
      layouts[w] = { fields: FIELDS[w], variants };
    }
    // The formula band: one line at display size, beside a figure or across (equation-hero).
    const eq = byId.get("equation-hero") as Doc;
    const formula = (fig: boolean) => {
      const v = eq.variants.find((x) => !!x.figure === fig) as Variant;
      return largest(
        (k) =>
          clean(
            g,
            () => ({ ...input(eq, v, 10, heading, 0), formula: sample(k) }) as TemplateInput,
          ),
        80,
      );
    };
    out[g] = { heading, formula: formula(false), formulaBesideFigure: formula(true), layouts };
  }
  return {
    note: "generated by lab/bakeoff/fit-table.ts (layoutTemplate with every field at its limit, every theme of the group); do not edit",
    groups: out,
  };
}

if (import.meta.main) {
  // bun packages/slides/src/templates/fit-table.ts --hinge-cards packages/generation/src/writer/hinge-cards.gen.json
  const cards = process.argv[2] === "--hinge-cards";
  const out = cards ? (process.argv[3] ?? "hinge-cards.json") : OUT;
  writeFileSync(
    out,
    `${cards ? JSON.stringify(measureHingeCards(), null, 2) : JSON.stringify(measureFit(), null, 1)}\n`,
  );
  console.log("wrote", out);
}
