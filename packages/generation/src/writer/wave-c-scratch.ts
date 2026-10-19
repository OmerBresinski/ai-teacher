/*
 * SCRATCH ONLY (loop1b-fullmenu-scratch, never pushed): the wave C layouts offered to the writer
 * as if all of them were in production, so the writer can be tested against the final menu.
 * Structure and counts only; every number comes from the slides' capacity tables. The menu
 * wording is the prompt-engineer's (build/BRIEF-pe-572-wording.md, "scratch-test first").
 */
import FIGURE_CAPACITY from "@tj/slides/templates/figure-capacity.json" with { type: "json" };
import MYTH_CAPACITY from "@tj/slides/templates/myth-capacity.json" with { type: "json" };
import { KEY_CAPS, PT_CAPS } from "@tj/slides/templates/picture-text";
import PICTURE_TEXT_CAPACITY from "@tj/slides/templates/picture-text-capacity.json" with {
  type: "json",
};
import REASONS_CAPACITY from "@tj/slides/templates/reasons-capacity.json" with { type: "json" };
import SOURCE_CAPACITY from "@tj/slides/templates/source-capacity.json" with { type: "json" };
import STAGES_CAPACITY from "@tj/slides/templates/stages-capacity.json" with { type: "json" };
import STEPS_MODEL_CAPACITY from "@tj/slides/templates/steps-model-capacity.json" with {
  type: "json",
};
import WORKED_CAPACITY from "@tj/slides/templates/worked-capacity.json" with { type: "json" };
import type { WriterStage } from "./schema";
import { CHARS_PER_WORD, wordsWithin } from "./shown-cap";

type J = Record<string, any>;
type Age = "early" | "primary" | "secondary";
const AGE: Record<WriterStage, Age> = { KS1: "early", KS2: "primary", "KS3-5": "secondary" };

/** Stages not offered (loop 1b): KS2 six pictured stages. */
const STAGES_NOT_OFFERED: Partial<Record<WriterStage, { n: number; vis: string }[]>> = {
  KS2: [{ n: 6, vis: "pictures" }],
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

/** The wave C writer defs at a stage (template names as the materialiser reads them). */
export function waveCDefs(s: WriterStage): J {
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
    source: obj({
      template: lit("source"),
      heading: str,
      form: { type: "string", enum: ["prose", "verse", "picture"] },
      from: str,
      extract: str,
      notes: list(obj({ anchor: str, label: str, text: str }), 2, 4),
      picture: picOrNull,
    }),
    "figure-slide": obj({
      template: lit("figure"),
      heading: str,
      caption: str,
      icon,
      figure: { anyOf: [{ $ref: "#/$defs/picture" }, { $ref: "#/$defs/diagram-side" }] },
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
    // steps-model wiring: one step beside a library model.
    "steps~step-model": obj({
      template: lit("steps"),
      fit: lit("step-model"),
      heading: str,
      step: obj({ n: { anyOf: [{ type: "integer" }, { type: "null" }] }, do: str, see: strOrNull }),
      figure: { $ref: "#/$defs/diagram-side" },
    }),
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
  const src = (SOURCE_CAPACITY as J)[age];
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
    source: { extractWords: src.comfortWords, extractLines: src.comfortLines },
    figure: { caption: ww((FIGURE_CAPACITY as J)[age]) },
    myth: Object.fromEntries(Object.entries(m).map(([k, c]) => [k, (c as J).cap])),
    pictureText: { leadAndPoints: pt.comfortable },
    stepModel: { doOneLine: st.oneLine, doTwoLines: st.twoLines },
  };
}

/** Characters code checks a word budget against (scratch: words x the stage's chars a word). */
const chars = (words: number, s: WriterStage) => Math.ceil(words * CHARS_PER_WORD[s]);

/** The wave C defs capped (maxLength) for the caps request, from the loosest comfortable cell. */
export function capWaveCDefs(defs: J, s: WriterStage): J {
  const W = waveCWords(s);
  const max = (o: J, k: string) => Math.max(...Object.values(o).map((c: any) => c[k]));
  const set = (node: J | undefined, words: number) => {
    if (!node) return;
    if (node.type === "string") node.maxLength = chars(words, s);
    for (const b of node.anyOf ?? []) if (b.type === "string") b.maxLength = chars(words, s);
  };
  const out: J = {};
  const take = (k: string) => (defs[k] ? (out[k] = structuredClone(defs[k])) : undefined);
  const st = take("stages");
  if (st) {
    set(st.properties.items.items.properties.name, max(W.stages, "name"));
    set(st.properties.items.items.properties.line, max(W.stages, "line"));
  }
  const r = take("reasons");
  if (r) {
    set(r.properties.lead, max(W.reasons, "lead"));
    set(r.properties.items.items.properties.head, max(W.reasons, "head"));
    set(r.properties.items.items.properties.line, max(W.reasons, "line"));
  }
  const so = take("source");
  if (so) set(so.properties.extract, W.source.extractWords);
  const f = take("figure-slide");
  if (f) set(f.properties.caption, W.figure.caption);
  const my = take("myth");
  if (my) {
    const p = my.properties.myth.properties;
    set(p.claim, W.myth.claim);
    set(p.fact, W.myth.fact);
    set(p.proof.anyOf[0].properties.line, W.myth.proof);
  }
  const wk = take("worked");
  if (wk) set(wk.properties.lines.items.properties.move, W.worked.moveWords);
  const sm = take("steps~step-model");
  if (sm) set(sm.properties.step.properties.do, W.stepModel.doTwoLines);
  return out;
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

  const [nLo, nHi] = bounds(D.source.properties.notes);
  const my = W.myth;
  const [icLo, icHi] = bounds(
    D.myth.properties.myth.properties.proof.anyOf[0].properties.icons.anyOf[0],
  );
  const kc = D["visual-text~key-card-fig"].properties;
  const [cLo, cHi] = bounds(kc.cards);
  const points = Math.min(kc.points.maxItems, PT_CAPS[s].points);
  const K = KEY_CAPS;

  return {
    worked: `- worked: one problem solved one move at a time (flow shape worked example), one row per click: each row the move in words, then the equation it gives, with answer true on the row that reaches the answer. check is null or one line putting the answer back into the problem, the value put back in between asterisks. panel is null, or a bar model drawn beside the rows: algebra-bar (a, b, c) for an equation, percent-bar (amount, percent) for a percentage of an amount. A worked calculation comes here rather than equation-hero. Fits: the heading, the problem itself, ${upTo(wk.titleWords)}; up to ${wk.rows} rows, or ${wk.rowsWithPanel} with a panel; each move ${upTo(wk.moveWords)}.`,
    stages: `- stages: ${span(stageCounts[0] ?? 0, stageCounts.at(-1) ?? 0)} named stages of one process that runs one way (flow shape sequence), in a strip joined by arrows, each a name, one line on what happens at that stage, and its closest listed icon; every stage has a picture or none does. Stages of a process come here rather than steps or picture-sequence; a method pupils carry out goes to steps, and parts that work together go to items-row. Fits: ${runs(
      stageCounts.map((n): [number, string] => [n, stageCell(n)]),
      "stages",
    )}.`,
    reasons: `- reasons: the heading asks why or how something happened or is so (flow shape one big idea), answered by ${span(reasonNs[0] ?? 0, reasonNs.at(-1) ?? 0)} reasons, one per click, each a head, one line and its closest listed icon, or every icon null; kind chain is a chain of consequences instead, each link leading to the next, ${span(chainNs[0] ?? 0, chainNs.at(-1) ?? 0)} links. lead is null or one line under the question. A why or how question answered by its reasons comes here rather than panel-list or explain. Fits: the question ${upTo(anyR.question)}; the lead ${upTo(anyR.lead)}; ${runs(rCells("reasons"), "reasons")}; a chain of ${runs(rCells("chain"), "links")}.`,
    source: `- source: a real extract pupils read closely, as prose, verse or a picture, copied word for word from the context and never written by you as if it were a source, with from naming where it comes from and ${span(nLo, nHi)} notes, each pinned by its anchor to words copied exactly from the extract, with a label and one short line. picture is null unless the form is picture. Fits: the extract ${upTo(W.source.extractWords)}.`,
    "figure-slide": `- figure-slide: one library model or one photo filling the slide, for an idea pupils learn by looking at one figure whole, with a one-line caption and the topic's closest listed icon, shown if the figure fails. At most one figure-slide per lesson. A chart or diagram drawn from your data goes to big-visual. Fits: the caption ${upTo(W.figure.caption)}.`,
    myth: `- myth: one belief pupils plausibly hold, or a surprising truth, settled on its own slide: the claim in plain words, its verdict (myth or true), the fact that settles it, with factEm null or one exact span of the fact to show in colour, and proof null or one short line with ${span(icLo, icHi)} listed icons or one picture. opening vote asks the class first; straight starts at the verdict and is only for a myth. The slide asks no question: a belief among options to choose from goes to hinge. Fits: the heading ${upTo(my.title)}; the claim ${upTo(my.claim)}; the fact ${upTo(my.fact)}, or ${my.factPicture} with a proof picture; the proof ${upTo(my.proof)}.`,
    "visual-text key-card-fig": `- visual-text key-card-fig: a picture beside a lead, up to ${points} points and ${span(cLo, cHi)} key cards, for one named idea pupils need to see, plus the closest listed icon, shown if the picture fails. Each card is a word or rule (label, term and meaning), examples (label and pairs) or a fact (label, number and unit); fields a card does not use are null. A card with a meaning, examples or a number comes here rather than visual-text's points-1-key-fig. Fits: lead and points together ${upTo(W.pictureText.leadAndPoints)}; each label ${upTo(K.label)}; a term ${upTo(K.term)}; a meaning ${upTo(K.meaning)}; up to ${K.pairs} example pairs, ${upTo(K.side)} a side; a number up to ${K.num} characters, its unit ${upTo(K.unit)}.`,
    "steps step-model": `- steps step-model: one step of a method beside a library model that shows it, one step per slide: n is the step's number, or null for a single step; do says what to do in one sentence; see is null or one short line on what pupils see happen. A method shown on a library model comes here; a method in words alone goes to steps. Fits: do ${upTo(W.stepModel.doOneLine)} on one line, ${W.stepModel.doTwoLines} on two.`,
  };
}

/** The writer's system text with the wave C lines after the last teaching layout (before Key cards). */
export function withWaveCMenu(system: string, s: WriterStage): string {
  const at = system.indexOf("\nKey cards. ");
  if (at < 0) throw new Error("wave C menu: no Key cards line in the writer's system text");
  return `${system.slice(0, at)}\n${Object.values(waveCMenu(s)).join("\n")}${system.slice(at)}`;
}
