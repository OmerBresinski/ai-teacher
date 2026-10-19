/*
 * Wave C offered to the production writer (TEACH-110 part v): worked, stages, reasons, the figure
 * slide, myth, picture-text's key cards (`visual-text key-card-fig`) and the step model, as defs,
 * word caps and menu lines for the v4.8 pack (`PilotPack.waveC`). Every number comes from the
 * slides' capacity tables; none is typed. The menu wording is the prompt-engineer's, tested in
 * full-menu runs 1-4 (build/FULLMENU-RUN4.md). Source is built but not offered until the writer is
 * given a real extract to copy (it would otherwise write one as if it were a source).
 */
import FIGURE_CAPACITY from "@tj/slides/templates/figure-capacity.json" with { type: "json" };
import MYTH_CAPACITY from "@tj/slides/templates/myth-capacity.json" with { type: "json" };
import { KEY_CAPS, PT_CAPS } from "@tj/slides/templates/picture-text";
import PICTURE_TEXT_CAPACITY from "@tj/slides/templates/picture-text-capacity.json" with {
  type: "json",
};
import REASONS_CAPACITY from "@tj/slides/templates/reasons-capacity.json" with { type: "json" };
import STAGES_CAPACITY from "@tj/slides/templates/stages-capacity.json" with { type: "json" };
import STEPS_MODEL_CAPACITY from "@tj/slides/templates/steps-model-capacity.json" with {
  type: "json",
};
import WORKED_CAPACITY from "@tj/slides/templates/worked-capacity.json" with { type: "json" };
import L47 from "./bundles/pilot-v4.7/layouts.json" with { type: "json" };
import type { WriterStage } from "./schema";
import { wordsWithin } from "./shown-cap";

type J = Record<string, any>;
type Age = "early" | "primary" | "secondary";
const AGE: Record<WriterStage, Age> = { KS1: "early", KS2: "primary", "KS3-5": "secondary" };

/** Stages not offered: six pictured stages at KS2 and KS3 (a name holds no whole word there). */
const STAGES_NOT_OFFERED: Partial<Record<WriterStage, { n: number; vis: string }[]>> = {
  KS2: [{ n: 6, vis: "pictures" }],
  "KS3-5": [{ n: 6, vis: "pictures" }],
};

const str = { type: "string" };
const strOrNull = { anyOf: [{ type: "string" }, { type: "null" }] };
const icon = { $ref: "#/$defs/layout-icon" };
const picOrNull = { anyOf: [{ $ref: "#/$defs/picture" }, { type: "null" }] };
const obj = (props: J): J => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(props),
  properties: props,
});
const list = (items: J, min: number, max: number): J => ({
  type: "array",
  items,
  minItems: min,
  maxItems: max,
});
const lit = (v: string) => ({ type: "string", enum: [v] });

type StageCell = { n: number; vis: string; name: { cap: number }; line: { cap: number } };
const stageCells = (s: WriterStage): StageCell[] =>
  ((STAGES_CAPACITY as J)[AGE[s]] as StageCell[]).filter(
    (c) =>
      !(STAGES_NOT_OFFERED[s] ?? []).some((x) => x.n === c.n && x.vis === c.vis) &&
      // A cell whose name holds no whole word is not offered (KS3 six pictured stages).
      wordsWithin(c.name.cap, s) >= 1,
  );
/** Reasons cells the age takes: a measured cap of 0 is not offered (KS1 has no fourth reason). */
const reasonsCells = (s: WriterStage): Record<string, J> =>
  Object.fromEntries(
    Object.entries((REASONS_CAPACITY as J)[AGE[s]] as Record<string, J>).filter(
      ([, c]) => c.line.cap > 0,
    ),
  );
const countOf = (k: string) => Number(k.split("-")[1]);

/** The flow shape a why or how question takes (pe-wavec2): reasons had none, so it hid in "one big idea". */
export const WHY_SHAPE = "reasons or causes";
/** v4.7's flow shapes with the why shape after "one big idea" (the v4.8 schema's `shape` enum). */
export const WAVE_C_FLOW_SHAPES: string[] = (L47.flowShapes as string[]).flatMap((s) =>
  s === "one big idea" ? [s, WHY_SHAPE] : [s],
);

/**
 * The wave C writer defs at a stage (template names as the materialiser reads them). `hasModels`:
 * the request carries the lesson's library models (`dg-model-full`, from `libSchema`). A model is
 * the figure the figure slide and the step model are built for; without one, figure-slide takes a
 * photo only and step-model is not offered (pe-wavec2: both pointed at diagram-side, which holds no
 * model, so neither could carry one).
 */
export function waveCDefs(s: WriterStage, hasModels = false): J {
  const age = AGE[s];
  const w = (WORKED_CAPACITY as J)[age];
  const ns = stageCells(s).map((c) => c.n);
  const rk = Object.keys(reasonsCells(s));
  const rn = rk.filter((k) => k.startsWith("reasons-")).map(countOf);
  const cn = rk.filter((k) => k.startsWith("chain-")).map(countOf);
  return {
    worked: obj({
      template: lit("worked"),
      heading: str,
      lines: list(obj({ move: strOrNull, eq: str, answer: { type: "boolean" } }), 1, w.base),
      check: strOrNull,
      panel: {
        anyOf: [
          obj({
            model: lit("algebra-bar"),
            a: { type: "number" },
            b: { type: "number" },
            c: { type: "number" },
          }),
          obj({
            model: lit("percent-bar"),
            amount: { type: "number" },
            percent: { type: "number" },
          }),
          { type: "null" },
        ],
      },
    }),
    stages: obj({
      template: lit("stages"),
      heading: str,
      accentWord: strOrNull,
      items: list(
        obj({ name: str, line: str, icon, picture: picOrNull }),
        Math.min(...ns),
        Math.max(...ns),
      ),
    }),
    reasons: obj({
      template: lit("reasons"),
      heading: str,
      lead: strOrNull,
      kind: { type: "string", enum: ["reasons", "chain"] },
      items: list(
        obj({ head: str, line: str, icon }),
        Math.min(...rn, ...cn),
        Math.max(...rn, ...cn),
      ),
    }),
    "figure-slide": obj({
      template: lit("figure"),
      heading: str,
      caption: str,
      icon,
      figure: hasModels
        ? { anyOf: [{ $ref: "#/$defs/picture" }, { $ref: "#/$defs/dg-model-full" }] }
        : { $ref: "#/$defs/picture" },
    }),
    myth: obj({
      template: lit("myth"),
      heading: str,
      myth: obj({
        opening: { type: "string", enum: ["vote", "straight"] },
        verdict: { type: "string", enum: ["myth", "true"] },
        claim: str,
        fact: str,
        factEm: strOrNull,
        proof: {
          anyOf: [
            obj({
              line: str,
              icons: { anyOf: [list(icon, 1, 3), { type: "null" }] },
              picture: picOrNull,
            }),
            { type: "null" },
          ],
        },
      }),
    }),
    // pictureText wiring: the key card look beside a picture (picture-text's `pictureText`).
    "visual-text~key-card-fig": obj({
      template: lit("visual-text"),
      fit: lit("key-card-fig"),
      heading: str,
      lead: str,
      points: list(str, 0, 3),
      icon,
      cards: list(
        obj({
          kind: { type: "string", enum: ["word", "rule", "examples", "fact"] },
          label: str,
          term: strOrNull,
          meaning: strOrNull,
          examples: { anyOf: [list(list(str, 2, 2), 1, 3), { type: "null" }] },
          num: strOrNull,
          unit: strOrNull,
        }),
        1,
        2,
      ),
      figure: { $ref: "#/$defs/picture" },
    }),
    // steps-model wiring: one step beside a library model, offered only when the lesson has one.
    ...(hasModels
      ? {
          "steps~step-model": obj({
            template: lit("steps"),
            fit: lit("step-model"),
            heading: str,
            step: obj({
              // One digit in the step disc (steps-model.ts draws n in a disc beside the heading).
              n: { anyOf: [{ type: "integer", minimum: 1, maximum: 9 }, { type: "null" }] },
              do: str,
              see: strOrNull,
            }),
            figure: { $ref: "#/$defs/dg-model-full" },
          }),
        }
      : {}),
  };
}

/**
 * The wave C word budgets at a stage, as the brief and the run's metrics read them. Tables in
 * characters go to words by `wordsWithin`; tables in words are as measured.
 */
export function waveCWords(s: WriterStage): J {
  const age = AGE[s];
  const ww = (c: number) => wordsWithin(c, s);
  const m = (MYTH_CAPACITY as J)[age];
  const st = (STEPS_MODEL_CAPACITY as J)[s];
  const pt = (PICTURE_TEXT_CAPACITY as J)[s];
  return {
    worked: {
      rows: WORKED_CAPACITY[age].base,
      rowsWithPanel: WORKED_CAPACITY[age].panel,
      moveWords: WORKED_CAPACITY[age].moveWords,
      titleWords: WORKED_CAPACITY[age].titleWords,
    },
    stages: Object.fromEntries(
      stageCells(s).map((c) => [`${c.n}-${c.vis}`, { name: ww(c.name.cap), line: ww(c.line.cap) }]),
    ),
    reasons: Object.fromEntries(
      Object.entries(reasonsCells(s)).map(([k, c]) => [
        k,
        {
          question: ww(c.question.cap),
          lead: ww(c.lead.cap),
          head: ww(c.head.cap),
          line: ww(c.line.cap),
        },
      ]),
    ),
    figure: { caption: ww((FIGURE_CAPACITY as J)[age]) },
    myth: Object.fromEntries(Object.entries(m).map(([k, c]) => [k, (c as J).cap])),
    pictureText: { leadAndPoints: pt.comfortable },
    stepModel: { doOneLine: st.oneLine, doTwoLines: st.twoLines },
  };
}

/** Sets a word cap on a string node (and its string branches): `maxWords`, read by slot-fill. */
const capWords = (node: J | undefined, words: number) => {
  if (!node) return;
  if (node.type === "string") node.maxWords = words;
  for (const b of node.anyOf ?? []) if (b.type === "string") b.maxWords = words;
};

/**
 * The wave C defs with word caps for the caps request (`maxWords`, straight from `waveCWords` and
 * picture-text's `KEY_CAPS`): code checks each field's words against these (`slotFillArrival`);
 * the writer never sees them. No characters are derived from words. A field whose room depends on
 * the slide's count (stages, reasons, worked rows, picture-text points) carries the loosest cell
 * here and is checked at its own count by `waveCCountCaps`. `headingWords` is the stage's measured
 * slide-heading words (fit-fits.ts `headingWords`), for headings no wave C table measures.
 */
export function waveCWordCaps(defs: J, s: WriterStage, headingWords: number): J {
  const W = waveCWords(s);
  const max = (o: J, k: string) => Math.max(...Object.values(o).map((c) => (c as J)[k] as number));
  const out: J = {};
  const take = (k: string): J | undefined => {
    if (!defs[k]) return undefined;
    // A JSON copy, not structuredClone: the defs share one string node (`str`) across fields.
    out[k] = JSON.parse(JSON.stringify(defs[k]));
    return out[k];
  };
  const st = take("stages");
  if (st) {
    capWords(st.properties.heading, headingWords);
    // The accent is a span of the heading, so it holds no more than the heading does.
    capWords(st.properties.accentWord, headingWords);
    capWords(st.properties.items.items.properties.name, max(W.stages, "name"));
    capWords(st.properties.items.items.properties.line, max(W.stages, "line"));
  }
  const r = take("reasons");
  if (r) {
    // The heading is the question (reasons-capacity.json `question`).
    capWords(r.properties.heading, max(W.reasons, "question"));
    capWords(r.properties.lead, max(W.reasons, "lead"));
    capWords(r.properties.items.items.properties.head, max(W.reasons, "head"));
    capWords(r.properties.items.items.properties.line, max(W.reasons, "line"));
  }
  const f = take("figure-slide");
  if (f) {
    capWords(f.properties.heading, headingWords);
    capWords(f.properties.caption, W.figure.caption);
  }
  const my = take("myth");
  if (my) {
    // myth-capacity.json `title` is the slide's heading.
    capWords(my.properties.heading, W.myth.title);
    const p = my.properties.myth.properties;
    capWords(p.claim, W.myth.claim);
    capWords(p.fact, W.myth.fact);
    // factEm is an exact span of the fact, so the fact's cap bounds it.
    capWords(p.factEm, W.myth.fact);
    capWords(p.proof.anyOf[0].properties.line, W.myth.proof);
  }
  const wk = take("worked");
  if (wk) {
    capWords(wk.properties.heading, W.worked.titleWords);
    capWords(wk.properties.lines.items.properties.move, W.worked.moveWords);
    // eq and check are maths, measured where they are drawn: worked.ts lays each equation and the
    // check at the gold's size and falls back to its text-only base when a row does not fit.
  }
  const kc = take("visual-text~key-card-fig");
  if (kc) {
    const p = kc.properties;
    capWords(p.heading, headingWords);
    capWords(p.lead, W.pictureText.leadAndPoints);
    // Each point within the lead-and-points budget; the two together at the count (`waveCCountCaps`).
    capWords(p.points.items, W.pictureText.leadAndPoints);
    const c = p.cards.items.properties;
    capWords(c.label, KEY_CAPS.label);
    capWords(c.term, KEY_CAPS.term);
    capWords(c.meaning, KEY_CAPS.meaning);
    capWords(c.examples.anyOf[0].items.items, KEY_CAPS.side);
    capWords(c.unit, KEY_CAPS.unit);
    // The fact card's number is measured in characters (picture-text KEY_CAPS.num).
    for (const b of c.num.anyOf ?? []) if (b.type === "string") b.maxLength = KEY_CAPS.num;
  }
  const sm = take("steps~step-model");
  if (sm) {
    capWords(sm.properties.heading, headingWords);
    capWords(sm.properties.step.properties.do, W.stepModel.doTwoLines);
    // see shares do's body line (steps-model.ts: do + see within two lines), so one line at most.
    capWords(sm.properties.step.properties.see, W.stepModel.doOneLine);
  }
  return out;
}

const wordsOf = (t: unknown) =>
  typeof t === "string" ? t.trim().split(/\s+/).filter(Boolean).length : 0;

/**
 * A wave C slide's caps at its own count (review, 19 Oct 2026): `caps` overrides `maxWords` by
 * path (`items[].line`), and `cuts` names what the count itself breaks (a count no cell offers,
 * more worked rows than a panel leaves room for, lead and points over their shared budget).
 */
export function waveCCountCaps(
  layout: string,
  fit: string | undefined,
  raw: J,
  s: WriterStage,
): { caps: Record<string, number>; cuts: string[] } {
  const W = waveCWords(s);
  const caps: Record<string, number> = {};
  const cuts: string[] = [];
  const items = Array.isArray(raw.items) ? (raw.items as J[]) : [];
  if (layout === "stages") {
    const vis = items.some((i) => i?.picture) ? "pictures" : "icons";
    const cell = W.stages[`${items.length}-${vis}`] as J | undefined;
    if (!cell) cuts.push("items");
    else {
      caps["items[].name"] = cell.name;
      caps["items[].line"] = cell.line;
    }
  } else if (layout === "reasons") {
    const kind = raw.kind === "chain" ? "chain" : "reasons";
    const cell = W.reasons[`${kind}-${items.length}`] as J | undefined;
    if (!cell) cuts.push("items");
    else {
      caps.heading = cell.question;
      caps.lead = cell.lead;
      caps["items[].head"] = cell.head;
      caps["items[].line"] = cell.line;
    }
  } else if (layout === "worked") {
    const lines = Array.isArray(raw.lines) ? raw.lines.length : 0;
    if (raw.panel && typeof raw.panel === "object" && lines > W.worked.rowsWithPanel)
      cuts.push("lines");
  } else if (layout === "myth") {
    // A proof picture leaves the fact less room (myth-capacity.json `factPicture`).
    const proof = (raw.myth as J | undefined)?.proof as J | null | undefined;
    if (proof?.picture) caps["myth.fact"] = W.myth.factPicture;
  } else if (layout === "visual-text" && fit === "key-card-fig") {
    const points = Array.isArray(raw.points) ? (raw.points as unknown[]) : [];
    if (points.length > PT_CAPS[s].points) cuts.push("points");
    const together = wordsOf(raw.lead) + points.reduce((n: number, p) => n + wordsOf(p), 0);
    if (together > W.pictureText.leadAndPoints) cuts.push("lead");
  }
  return { caps, cuts };
}

/* ------------------------------------------------------------------ */
/* The wave C menu lines (prompt-engineer, 19 Oct 2026)                */
/* ------------------------------------------------------------------ */

const span = (lo: number, hi: number) => (lo === hi ? `${lo}` : `${lo} to ${hi}`);
const upTo = (w: number) => (w === 1 ? "one word" : `up to ${w} words`);
/** Adjacent counts with equal text joined: [[3, "a"], [4, "a"], [5, "b"]] -> "3 to 4 x: a; 5 x: b". */
const runs = (cells: [number, string][], noun: string) => {
  const out: string[] = [];
  for (let i = 0; i < cells.length; ) {
    let j = i;
    while (j + 1 < cells.length && cells[j + 1]?.[1] === cells[i]?.[1]) j += 1;
    out.push(`${span(cells[i]?.[0] ?? 0, cells[j]?.[0] ?? 0)} ${noun}: ${cells[i]?.[1]}`);
    i = j + 1;
  }
  return out.join("; ");
};
const bounds = (node: J) => [node.minItems as number, node.maxItems as number] as const;

/**
 * Each wave C layout's menu line at a stage, keyed by the name the flow's `layout` enum gives it
 * (`flowLayoutOf`). Every number is read from `waveCWords` (the capacity tables), the defs' own
 * item bounds, or picture-text's `KEY_CAPS`/`PT_CAPS`; none is typed. Each line says when the layout
 * is the right one, and where it overlaps a layout already offered, which one takes the case.
 */
export function waveCMenu(s: WriterStage): Record<string, string> {
  const W = waveCWords(s);
  const D = waveCDefs(s);
  const wk = W.worked;

  const stageCounts = [...new Set(stageCells(s).map((c) => c.n))].sort((a, b) => a - b);
  const stageCell = (n: number) => {
    const icons = W.stages[`${n}-icons`];
    const pics = W.stages[`${n}-pictures`];
    const name = upTo(Math.min(...[icons, pics].filter(Boolean).map((c: J) => c.name)));
    if (icons && pics)
      return icons.line === pics.line
        ? `names ${name}, lines ${upTo(icons.line)}`
        : `names ${name}, lines ${upTo(icons.line)} with icons or ${pics.line} with pictures`;
    if (icons) return `icons, not pictures; names ${name}, lines ${upTo(icons.line)}`;
    return `pictures, not icons; names ${name}, lines ${upTo(pics.line)}`;
  };

  const R = W.reasons as Record<string, J>;
  const rCells = (kind: string) =>
    Object.entries(R)
      .filter(([k]) => k.startsWith(`${kind}-`))
      .map(([k, c]): [number, string] => [
        countOf(k),
        `heads ${upTo(c.head)}, lines ${upTo(c.line)}`,
      ])
      .sort((a, b) => a[0] - b[0]);
  const reasonNs = rCells("reasons").map(([n]) => n);
  const chainNs = rCells("chain").map(([n]) => n);
  const anyR = Object.values(R)[0] as J;

  const my = W.myth;
  const [icLo, icHi] = bounds(
    D.myth.properties.myth.properties.proof.anyOf[0].properties.icons.anyOf[0],
  );
  const kc = D["visual-text~key-card-fig"].properties;
  const [cLo, cHi] = bounds(kc.cards);
  const points = Math.min(kc.points.maxItems, PT_CAPS[s].points);
  const K = KEY_CAPS;

  return {
    worked: `- worked: one problem solved one move at a time (flow shape worked example), one row per click: each row the move in words, then the equation it gives, with answer true on the row that reaches the answer. check is null or one line putting the answer back into the problem, the value put back in between asterisks. panel is null, or a bar model drawn beside the rows: algebra-bar (a, b, c) for an equation, percent-bar (amount, percent) for a percentage of an amount. A worked calculation comes here rather than equation-hero, unless it needs a graph or diagram beside it other than these bar models. Fits: the heading, the problem itself, ${upTo(wk.titleWords)}; up to ${wk.rows} rows, or ${wk.rowsWithPanel} with a panel; each move ${upTo(wk.moveWords)}.`,
    stages: `- stages: ${span(stageCounts[0] ?? 0, stageCounts.at(-1) ?? 0)} named stages of one process that runs one way (flow shape sequence), in a strip joined by arrows, each a name, one line on what happens at that stage (empty for a stage whose name says it all, never for every stage), and its closest listed icon; every stage has a picture or none does. A one-way process pupils learn stage by stage, by what happens at each, comes here rather than steps or picture-sequence, with a picture on every stage when each is a thing a camera shows; picture-sequence is for frames pupils need only to name. A method pupils carry out goes to steps, and parts that work together go to items-row. Fits: ${runs(
      stageCounts.map((n): [number, string] => [n, stageCell(n)]),
      "stages",
    )}.`,
    reasons: `- reasons: why or how something happened or is so (flow shape ${WHY_SHAPE}): the heading asks the question, answered on this one slide by ${span(reasonNs[0] ?? 0, reasonNs.at(-1) ?? 0)} reasons, one per click, each a head, one line and its closest listed icon; kind chain is a chain of consequences instead, each link leading to the next, ${span(chainNs[0] ?? 0, chainNs.at(-1) ?? 0)} links. lead is null or one line under the question. The reasons of a why or how question come here together, rather than one visual-text slide a reason, a flow diagram of causes, panel-list or explain. The slide carries no picture or diagram: give every reason its closest listed icon whenever the listed icons cover them all, and every icon null only when they do not; the slide then shows words alone. Reasons pupils learn by seeing, through a diagram or model that explains them or a picture of the thing, place or event, go to visual-text beside that figure rather than here. Otherwise, a reason pupils must see to grasp may take a picture slide of its own after this one, never in its place. Fits: the question ${upTo(anyR.question)}; the lead ${upTo(anyR.lead)}; ${runs(rCells("reasons"), "reasons")}; a chain of ${runs(rCells("chain"), "links")}.`,
    "figure-slide": `- figure-slide: one figure filling the slide that carries the slide's idea on its own, so pupils learn it by looking at the figure whole: a model from the Models list, or a photo pupils study the way they would a model. A one-line caption says what to take from it, with the topic's closest listed icon, shown if the figure fails. At most one figure-slide per lesson. Such a model comes here rather than big-visual, and a further one goes to big-visual; a chart or diagram drawn from your data goes to big-visual. Fits: the caption ${upTo(W.figure.caption)}.`,
    myth: `- myth: the misconception slide: one belief pupils of this age commonly hold about what this lesson's objectives teach, one a teacher would recognise, settled on its own slide: the claim in plain words, its verdict (myth, or true for a true claim pupils commonly doubt), the fact that settles it, using only ideas this lesson teaches or pupils of this age already know, with factEm null or one exact span of the fact to show in colour, and proof null or one short line with ${span(icLo, icHi)} listed icons or one picture. opening vote asks the class first; straight starts at the verdict and is only for a myth. The slide asks no question: a belief among options to choose from goes to hinge. The proof holds no diagram: a misconception pupils see put right on a diagram or model goes to visual-text, with a watch-out key card beside it. A lesson whose objectives pupils hold no such belief about has no myth slide; never make one up, or reach past the objectives for one. Fits: the heading ${upTo(my.title)}; the claim ${upTo(my.claim)}; the fact ${upTo(my.fact)}, or ${my.factPicture} with a proof picture; the proof ${upTo(my.proof)}.`,
    "visual-text key-card-fig": `- visual-text key-card-fig: a picture beside a lead, up to ${points} points and ${span(cLo, cHi)} key cards, for one named idea pupils need to see, plus the closest listed icon, shown if the picture fails. Each card is a word or rule (label, term and meaning), examples (label and pairs) or a fact (label, number and unit); fields a card does not use are null. A card with a meaning, examples or a number comes here rather than visual-text's points-1-key-fig. Fits: lead and points together ${upTo(W.pictureText.leadAndPoints)}; each label ${upTo(K.label)}; a term ${upTo(K.term)}; a meaning ${upTo(K.meaning)}; up to ${K.pairs} example pairs, ${upTo(K.side)} a side; a number up to ${K.num} characters, its unit ${upTo(K.unit)}.`,
    "steps step-model": `- steps step-model: one step of a method shown on a model from the Models list, one step per slide, the model's intent saying what it shows at that step: n is the step's number, or null for a single step; do says what to do in one sentence; see is null or one line on what pupils see happen on the model. The see line shows only when do and see each fit on one line: when see matters, keep do to one line; when do needs two lines, see is null. A method a listed model shows comes here, a slide a step, rather than steps followed by the model on big-visual; a method in words alone, or one no listed model shows, goes to steps. Fits: do ${upTo(W.stepModel.doOneLine)} on one line, ${W.stepModel.doTwoLines} on two; see ${upTo(W.stepModel.doOneLine)}.`,
  };
}

/**
 * Fits the v4.8 pack routes to a wave C layout (never sent): two pictures go to split-compare
 * (stages hold three or more), and a calculation with no figure to worked, which equals the gold
 * there; equation-hero keeps only its fits with a graph or diagram, which worked cannot hold.
 * Retiring picture-sequence or equation-hero outright waits for Greg (decision items 49 and 50).
 */
export const WAVE_C_ROUTED_FITS = [
  "picture-sequence~sequence-2",
  "equation-hero~points-2",
  "equation-hero~points-3",
  "equation-hero~points-4",
] as const;

/** Offered only with a library model, so its line joins the menu with the Models list (`withWaveCLibrary`). */
const MODEL_ONLY = "steps step-model";

/**
 * The wave C menu lines at a stage, in menu order, for the template's `{{menu:wave-c}}` slot:
 * every line but step-model's, which a lesson without a library model is never offered.
 */
export const waveCMenuBlock = (s: WriterStage): string =>
  Object.entries(waveCMenu(s))
    .filter(([k]) => k !== MODEL_ONLY)
    .map(([, l]) => l)
    .join("\n");

/** The library models' menu line (appended by `libSystem`) with figure-slide and step-model able to take a model. */
const LIB_FROM =
  "Unlike the kinds above, a model always fills a big-visual slide of its own: its heading, the drawing, and a caption of one short line saying what pupils should take from it.";
const LIB_TO =
  "Unlike the kinds above, a model always fills a slide of its own: big-visual, with its heading, the drawing, and a caption of one short line saying what pupils should take from it, unless figure-slide or steps step-model takes it, as their lines say.";
/**
 * A wave C system text for a lesson with library models (the Models list is in it): the model line
 * names figure-slide and step-model, and step-model's line joins the menu after the wave C block.
 * Without models the text is unchanged, so step-model is neither offered nor described.
 */
export function withWaveCLibrary(system: string, s: WriterStage): string {
  if (!system.includes("\nModels (id")) return system;
  if (system.split(LIB_FROM).length !== 2)
    throw new Error("wave C library: model line not found once");
  const at = system.indexOf("\nKey cards. ");
  if (at < 0) throw new Error("wave C library: no Key cards line to put step-model's line before");
  const line = waveCMenu(s)[MODEL_ONLY];
  return `${system.slice(0, at)}\n${line}${system.slice(at)}`.replace(LIB_FROM, LIB_TO);
}

/** The library's model menu line as a wave C pack sends it (`withWaveCLibrary`). */
export const waveCLibraryLine = (menuLine: string): string => menuLine.replace(LIB_FROM, LIB_TO);
