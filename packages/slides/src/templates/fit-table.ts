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
import { atFullSize, G, layoutTemplate, type TemplateInput, templateScale } from "./index";
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
const sample = (n: number, seed = 0) => {
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
      const lay = () => {
        try {
          return layoutTemplate(make(), getTheme(th), st as never).over.length === 0;
        } catch {
          return false;
        }
      };
      return LADDER ? lay() : atFullSize(lay);
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
  writeFileSync(OUT, `${JSON.stringify(measureFit(), null, 1)}\n`);
  console.log("wrote", OUT);
}
