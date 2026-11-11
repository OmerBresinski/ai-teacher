/**
 * The gold manifest (gold alignment, 11 Nov 2026): for every writer layout and each way of filling
 * it that routes on its own, the approved gold design's drawer that must draw it in a new lesson,
 * the legacy drawer kept for saved documents, and, where no gold draws it yet, why (a known gap).
 * The founder's rulings: the golds are the standard and are never altered to suit the writer; a new
 * lesson never lands on an old layout where a gold exists; saved lessons keep their look.
 *
 * `gold-manifest.test.ts` lays each entry's sample through the real `toInput` and `layoutTemplate`
 * and checks the drawer (`TemplateResult.drawer`). Every layout the live pack offers needs an entry,
 * so a new layout or a new old-code path fails until it is routed to its gold or listed here.
 */
import type { Drawer } from "@tj/slides/templates";
import type { VisualState } from "./materialise";

type S = Record<string, unknown>;
export type GoldStage = "ks1" | "ks2" | "ks3";

export type GoldEntry = {
  /** The writer's layout: its schema `template`. */
  layout: string;
  /** The way of filling it that routes on its own. */
  variant: string;
  /** The gold drawer that must draw it for a new lesson; null is a known gap. */
  gold: Drawer | null;
  /** The old drawer: kept for saved documents, and the one that draws it while `gold` is null. */
  legacy?: Drawer;
  /** Why no gold draws it in a new lesson (only with `gold: null`). */
  gap?: string;
  /** An unported gold's pilot mock-up (`quality-prd/lab/rounds/NORTHSTAR/pilot/…`). */
  mockup?: string;
  /** The writer's slide (as the schema writes it) and the visuals' states by key. */
  sample: {
    slide: S;
    visual?: Record<string, VisualState>;
    stage?: GoldStage;
    draft?: boolean;
    /** The lesson's writer slides (the sample is `slides[index]`); default: the sample alone at 3. */
    slides?: S[];
    index?: number;
  };
  /** Words the laid slide must show (the writer's words that routing could drop). */
  shows?: string[];
  /** Not yet routed to its gold (the guard's list of what is wrong); the test pins `legacy` meanwhile. */
  todo?: string;
};

const PILOT = "quality-prd/lab/rounds/NORTHSTAR/pilot";
/** A recorded-shape photo (3:2) and a near-square and a wide library model, already drawn. */
const PHOTO: VisualState = {
  status: "photo",
  photo: { src: "/files/x.jpg", alt: "A plant in soil", aspect: 1.5 } as never,
};
const svg = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#fff"/><text x="10" y="40" font-size="20">Root</text></svg>`;
const MODEL_SQUARE: VisualState = {
  status: "diagram",
  spec: { drawn: { src: svg(120, 100), aspect: 1.2, bare: true, alt: "A plant model" } },
};
const MODEL_WIDE: VisualState = {
  status: "diagram",
  spec: { drawn: { src: svg(200, 100), aspect: 2, bare: true, alt: "A river model" } },
};
/** A data diagram drawn from the writer's spec (no library model). */
const CYCLE_SPEC = { kind: "cycle", alt: "The water cycle", steps: ["Rain", "River", "Sea"] };
const CYCLE: VisualState = { status: "diagram", spec: CYCLE_SPEC };
const FAILED: VisualState = { status: "failed" };
const PENDING: VisualState = { status: "pending" };

const picAsk = { shows: "a plant in soil, roots showing", must_see: ["roots"] };
const modelAsk = { kind: "model", model: "plant_parts", shows: "the parts of a plant" };
const cycleAsk = { kind: "cycle", shows: "the water cycle", steps: ["Rain", "River", "Sea"] };

const vt = (fit: string, extra: S = {}): S => ({
  template: "visual-text",
  fit,
  heading: "Roots hold the plant",
  lead: "Roots grow down into the soil and take in water.",
  points: [],
  figure: picAsk,
  ...extra,
});
const bv = (figure: S, extra: S = {}): S => ({
  template: "big-visual",
  fit: "fig",
  heading: "The parts of a plant",
  lead: "Each part has a job.",
  figure,
  ...extra,
});
const fs = (extra: S = {}): S => ({
  template: "figure",
  heading: "The parts of a plant",
  caption: "Each part has a job.",
  icon: "plant",
  figure: modelAsk,
  ...extra,
});

export const GOLD_MANIFEST: GoldEntry[] = [
  // Picture and text (v13 gold, TEACH-75 part ae).
  {
    layout: "visual-text",
    variant: "photo, lead alone (points-0-fig)",
    gold: "gold:picture-text",
    legacy: "legacy:picture-text",
    sample: { slide: vt("points-0-fig"), visual: { picture: PHOTO } },
  },
  {
    layout: "visual-text",
    variant: "photo, lead and points (points-2-fig)",
    gold: "gold:picture-text",
    legacy: "legacy:picture-text",
    sample: {
      slide: vt("points-2-fig", { points: ["Roots take in water.", "Roots hold the soil."] }),
      visual: { picture: PHOTO },
    },
  },
  {
    layout: "visual-text",
    variant: "photo, a labelled point (points-1-key-fig, the retired callout)",
    todo: "the gold's plain column draws a point's text only: the label is dropped",
    gold: "gold:picture-text",
    legacy: "legacy:picture-text",
    sample: {
      slide: vt("points-1-key-fig", {
        points: [{ label: "Remember", text: "Roots take in water." }],
      }),
      visual: { picture: PHOTO },
    },
    shows: ["Remember"],
  },
  {
    layout: "visual-text",
    variant: "photo, key cards (key-card-fig)",
    gold: "gold:picture-text",
    legacy: "legacy:picture-text",
    sample: {
      slide: vt("key-card-fig", {
        lead: "",
        icon: "plant",
        cards: [
          {
            kind: "word",
            label: "Key word",
            term: "Root",
            meaning: "The part that takes in water.",
          },
        ],
      }),
      visual: { picture: PHOTO },
    },
  },
  {
    layout: "visual-text",
    variant: "picture still to come (draft)",
    gold: "gold:picture-text",
    legacy: "legacy:picture-text",
    sample: { slide: vt("points-0-fig"), visual: { picture: PENDING }, draft: true },
  },
  {
    layout: "visual-text",
    variant: "picture failed (the gold's no-picture look)",
    gold: "gold:picture-text",
    legacy: "nogold:explain",
    sample: { slide: vt("points-0-fig"), visual: { picture: FAILED } },
  },
  {
    layout: "visual-text",
    variant: "near-square library model beside the words",
    todo: "diagram-text never sets pictureText, so a near-square model gets the old side panel",
    gold: "gold:picture-text",
    legacy: "legacy:diagram-text",
    sample: { slide: vt("points-0-fig", { figure: modelAsk }), visual: { diagram: MODEL_SQUARE } },
  },
  {
    layout: "visual-text",
    variant: "wide library model beside the words",
    gold: null,
    legacy: "legacy:diagram-text",
    gap: "The picture-text gold takes only a model of aspect up to 1.45 (its NOTES: a wide one's labels drop to about 10 px) and routes a wide one to the figure slide, which has no lead or points: the slide's words would be lost. Needs a writer rule (a wide model goes on its own figure slide) or a ruling.",
    sample: { slide: vt("points-0-fig", { figure: modelAsk }), visual: { diagram: MODEL_WIDE } },
  },
  {
    layout: "visual-text",
    variant: "data diagram beside the words (flow, cycle, timeline, table, chart)",
    gold: null,
    legacy: "legacy:diagram-text",
    gap: "No gold design draws a data diagram beside words: the picture-text gold has a photo or a near-square library model only (v13 NOTES 'Picture rules'). The menu still offers 'beside text' counts for flow, cycle, timeline, layers and table.",
    sample: { slide: vt("points-0-fig", { figure: cycleAsk }), visual: { diagram: CYCLE } },
  },
  {
    layout: "visual-text",
    variant: "data diagram still to come (draft)",
    gold: null,
    legacy: "legacy:diagram-text",
    gap: "A diagram's shape is unknown until it is drawn, so a draft keeps the old diagram-beside-words slot; a near-square model then moves to the gold field when it lands (one visible re-lay).",
    sample: {
      slide: vt("points-0-fig", { figure: modelAsk }),
      visual: { diagram: PENDING },
      draft: true,
    },
  },
  // Figure slide (v13 gold, TEACH-239 part b): big-visual's gold ("Figure slide (was big visual)").
  {
    layout: "big-visual",
    variant: "wide library model, first in the lesson",
    gold: "gold:figure",
    legacy: "legacy:big-diagram",
    sample: { slide: bv(modelAsk), visual: { diagram: MODEL_WIDE } },
  },
  {
    layout: "big-visual",
    variant: "near-square library model",
    todo: "big-visual reaches the figure slide only for a wide model",
    gold: "gold:figure",
    legacy: "legacy:big-diagram",
    sample: { slide: bv(modelAsk), visual: { diagram: MODEL_SQUARE } },
  },
  {
    layout: "big-visual",
    variant: "second library model in the lesson",
    todo: "figureSlideAllowed (ruling 229) sends every model after the first to the old big diagram",
    gold: "gold:figure",
    legacy: "legacy:big-diagram",
    sample: {
      slide: bv(modelAsk),
      visual: { diagram: MODEL_WIDE },
      slides: [
        { template: "title" },
        { template: "objectives" },
        bv(modelAsk),
        vt("points-0-fig"),
        bv(modelAsk),
      ],
      index: 4,
    },
  },
  {
    layout: "big-visual",
    variant: "photo",
    gold: "gold:figure",
    todo: "big-visual photos go to the old big picture",
    legacy: "legacy:big-picture",
    sample: { slide: bv(picAsk), visual: { picture: PHOTO } },
  },
  {
    layout: "big-visual",
    variant: "photo, caption over the figure's two lines",
    gold: null,
    legacy: "legacy:big-picture",
    gap: "The figure gold holds a caption of two lines and cuts a longer one with an ellipsis (it flags it); the words would be lost, so the slide keeps the old big picture, whose caption wraps. Needs the writer to keep to the figure's caption cap.",
    sample: {
      slide: bv(picAsk, {
        lead: "Roots, stems, leaves and flowers each have a job: roots take in water, stems carry it up, leaves make food from light, air and water, and flowers make the seeds that grow into new plants next spring.",
      }),
      visual: { picture: PHOTO },
    },
  },
  {
    layout: "big-visual",
    variant: "data diagram or chart across the slide",
    gold: null,
    legacy: "legacy:big-diagram",
    gap: "The figure gold draws a library model or one photo ('There are no tables'); no gold design draws a data chart, graph or table across the slide (the table gold v13/table is a mock-up only).",
    mockup: `${PILOT}/northstars-v13/table`,
    sample: { slide: bv(cycleAsk), visual: { diagram: CYCLE } },
  },
  {
    layout: "big-visual",
    variant: "figure failed (no icon on big-visual)",
    gold: null,
    legacy: "nogold:explain",
    gap: "The figure gold's failed look is the icon plate, but big-visual's schema has no icon field (figure-slide has one), so a failed figure becomes words alone. Schema work: out of scope.",
    sample: { slide: bv(modelAsk), visual: { diagram: FAILED } },
  },
  {
    layout: "figure",
    variant: "library model (figure-slide)",
    gold: "gold:figure",
    legacy: "legacy:big-diagram",
    sample: { slide: fs(), visual: { figure: MODEL_WIDE } },
  },
  {
    layout: "figure",
    variant: "second figure slide in the lesson",
    todo: "figureSlideAllowed sends a second figure slide to the old big diagram",
    gold: "gold:figure",
    legacy: "legacy:big-diagram",
    sample: {
      slide: fs(),
      visual: { figure: MODEL_WIDE },
      slides: [{ template: "title" }, { template: "objectives" }, fs(), vt("points-0-fig"), fs()],
      index: 4,
    },
  },
  {
    layout: "figure",
    variant: "figure failed, with an icon (the plate)",
    gold: "gold:figure",
    legacy: "nogold:explain",
    sample: { slide: fs(), visual: { figure: FAILED } },
  },
  // Steps.
  {
    layout: "steps",
    variant: "one step on a library model (step-model)",
    gold: "gold:steps-model",
    sample: {
      slide: {
        template: "steps",
        fit: "step-model",
        heading: "Find a quarter",
        step: { n: 1, do: "Share 12 into 4 equal groups.", see: "Each group has 3." },
        figure: modelAsk,
      },
      visual: { figure: MODEL_WIDE },
    },
  },
  {
    layout: "steps",
    variant: "numbered steps (points-3/4/5, with or without a figure)",
    gold: null,
    legacy: "legacy:steps",
    gap: "The steps-family gold (ruling 219: an overview slide and a slide a step) is a pilot mock-up only, never ported.",
    mockup: `${PILOT}/northstars-v10/steps-family`,
    sample: {
      slide: {
        template: "steps",
        fit: "points-3",
        heading: "Plant a seed",
        points: ["Fill a pot with soil.", "Push the seed in.", "Water it."],
      },
    },
  },
  // Golds whose route is one drawer.
  {
    layout: "hinge",
    variant: "options",
    gold: "gold:hinge",
    sample: {
      slide: {
        template: "hinge",
        heading: "Which part takes in water?",
        options: [
          { text: "The roots", icon: null, why: null },
          { text: "The petals", icon: null, why: "Petals attract insects." },
          { text: "The stem", icon: null, why: "The stem carries water up." },
        ],
      },
    },
  },
  {
    layout: "question-set",
    variant: "quick check",
    gold: "gold:question-set",
    sample: {
      slide: {
        template: "question-set",
        heading: "Quick check",
        items: [
          { question: "What do roots take in?", answer: "Water" },
          { question: "What holds a plant up?", answer: "The stem" },
          { question: "Where are seeds made?", answer: "In the flower" },
        ],
      },
    },
  },
  {
    layout: "practice",
    variant: "tasks",
    gold: "gold:practice",
    sample: {
      slide: {
        template: "practice",
        heading: "Your turn",
        picture: null,
        items: [
          {
            question: "Draw a plant and label its roots.",
            answer: "Roots at the bottom",
            working: null,
          },
          { question: "Write one job of the stem.", answer: "It carries water", working: null },
        ],
      },
    },
  },
  {
    layout: "exit-ticket",
    variant: "questions",
    gold: "gold:exit-ticket",
    sample: {
      slide: {
        template: "exit-ticket",
        heading: "Exit ticket",
        items: [{ question: "Name one job of the roots.", answer: "Take in water", working: null }],
      },
    },
  },
  {
    layout: "items-row",
    variant: "parts of a whole",
    gold: "gold:items-row",
    sample: {
      slide: {
        template: "items-row",
        heading: "Parts of a plant",
        accentWord: null,
        lead: null,
        motif: null,
        items: [
          { name: "Roots", text: "Take in water", icon: null },
          { name: "Stem", text: "Holds it up", icon: null },
          { name: "Leaves", text: "Make food", icon: null },
        ],
      },
    },
  },
  {
    layout: "stages",
    variant: "stages with no icons or pictures (ruling 243's ordered row)",
    gold: "gold:stages",
    sample: {
      slide: {
        template: "stages",
        heading: "How a seed grows",
        accentWord: null,
        items: [
          { name: "Seed", line: "It rests in the soil.", icon: null, picture: null },
          { name: "Shoot", line: "It grows up to the light.", icon: null, picture: null },
          { name: "Plant", line: "It grows leaves.", icon: null, picture: null },
        ],
      },
    },
  },
  {
    layout: "panel-list",
    variant: "kinds, with a pie in the panel (shares)",
    gold: "gold:panel-list",
    sample: {
      slide: {
        template: "panel-list",
        heading: "What a plant needs",
        lead: null,
        panel: { shares: [3, 1] },
        items: [
          { name: "Water", text: "From the soil", icon: null, picture: null },
          { name: "Light", text: "From the Sun", icon: null, picture: null },
        ],
      },
    },
  },
  {
    layout: "split-compare",
    variant: "two sides",
    gold: "gold:split-compare",
    sample: {
      slide: {
        template: "split-compare",
        heading: "Seeds and bulbs",
        accentWord: null,
        sides: [
          {
            title: "Seed",
            text: "Small and hard; it grows a new plant.",
            quote: null,
            picture: null,
          },
          { title: "Bulb", text: "Round and fat; it stores food.", quote: null, picture: null },
        ],
      },
    },
  },
  {
    layout: "worked",
    variant: "maths working",
    gold: "gold:worked",
    sample: {
      slide: {
        template: "worked",
        heading: "Solve 3x + 5 = 20",
        lines: [
          { move: "Take 5 from both sides", eq: "3x = 15", answer: false },
          { move: "Divide both sides by 3", eq: "x = 5", answer: true },
        ],
        check: null,
        panel: null,
      },
      stage: "ks3",
    },
  },
  {
    layout: "reasons",
    variant: "reasons",
    gold: "gold:reasons",
    sample: {
      slide: {
        template: "reasons",
        heading: "Why do plants need roots?",
        lead: null,
        kind: "reasons",
        picture: null,
        items: [
          { head: "Water", line: "Roots take in water.", icon: null },
          { head: "Hold", line: "Roots hold the plant in the soil.", icon: null },
        ],
      },
    },
  },
  {
    layout: "myth",
    variant: "vote",
    gold: "gold:myth",
    sample: {
      slide: {
        template: "myth",
        heading: "Roots",
        myth: {
          claim: "Roots make water.",
          fact: "Roots take in water from the soil.",
          proof: null,
        },
      },
    },
  },
  // Golds that exist only as pilot mock-ups (never ported): the old drawers stay, listed.
  {
    layout: "objectives",
    variant: "code-filled",
    gold: null,
    legacy: "legacy:objectives",
    gap: "Ruling 233's objectives frame (goals with check rings, verb in bold) replaced 203 P12's numbered cards, but it is a pilot mock-up only: never ported (no template cites it).",
    mockup: `${PILOT}/northstars-v13/frame/frame.html?kind=objectives`,
    sample: { slide: { template: "objectives" }, index: 1 },
  },
  {
    layout: "hook",
    variant: "photo",
    gold: null,
    legacy: "legacy:hook",
    gap: "Ruling 233's hook (one stimulus plate and one short question) replaced 203 P5's full-bleed hook, but it is a pilot mock-up only; `hook.ts` is the 203 P5 copy.",
    mockup: `${PILOT}/northstars-v13/frame/frame.html?kind=hook (cases: northstars-v13/hook2/cases.js)`,
    sample: {
      slide: {
        template: "hook",
        fit: "fig",
        heading: "A tree drinks a bath a day",
        lead: "How?",
        picture: picAsk,
      },
      visual: { picture: PHOTO },
    },
  },
  {
    layout: "discussion",
    variant: "question, with or without a picture",
    gold: null,
    legacy: "legacy:discussion",
    gap: "The v13 discussion gold (poster, statement or quote, sentence starters) is a pilot mock-up only.",
    mockup: `${PILOT}/northstars-v13/discussion`,
    sample: {
      slide: {
        template: "discussion",
        fit: "bare",
        heading: "Talk",
        lead: "Could a plant live without roots?",
        picture: null,
      },
    },
  },
  ...(["pair", "group-sort", "sequence", "odd-one-out"] as const).map(
    (layout): GoldEntry => ({
      layout,
      variant: "cards",
      gold: null,
      legacy: "legacy:activity",
      gap: "The v13 activities redesign (D7) is a pilot mock-up only; `activities.ts` is the pre-gold drawer.",
      mockup: `${PILOT}/northstars-v13/activities`,
      sample: {
        slide:
          layout === "pair"
            ? { template: "pair", heading: "Match", cards: [{ text: "Root" }, { text: "Stem" }] }
            : layout === "group-sort"
              ? {
                  template: "group-sort",
                  heading: "Sort",
                  groups: ["Living", "Not living"],
                  cards: [
                    { text: "Tree", group: 1 },
                    { text: "Rock", group: 2 },
                  ],
                }
              : layout === "sequence"
                ? {
                    template: "sequence",
                    heading: "Order",
                    cards: [{ text: "Seed" }, { text: "Shoot" }, { text: "Plant" }],
                  }
                : {
                    template: "odd-one-out",
                    heading: "Odd one out",
                    cards: [{ text: "Rose" }, { text: "Oak" }, { text: "Rock" }],
                    correct: 3,
                    explanation: "A rock is not living.",
                  },
      },
    }),
  ),
  // Layouts no gold design exists for (kept or left by the founder).
  ...(
    [
      [
        "explain",
        "words alone",
        "Ruling 225 moves explain's job to reasons, but it is still on the menu.",
      ],
      [
        "picture-sequence",
        "pictures in a row",
        "Kept by ruling 221; dropped from the menu by the founder on 11 Nov (not yet off the live pack).",
      ],
      [
        "equation-hero",
        "formula and lines",
        "Kept by ruling 223 for a stated relationship; no gold design exists for it.",
      ],
      [
        "title",
        "cover",
        "Covers belong to the theming work (v13/frame: 'Covers are not designed here').",
      ],
    ] as const
  ).map(
    ([layout, variant, gap]): GoldEntry => ({
      layout,
      variant,
      gold: null,
      legacy: `nogold:${layout}`,
      gap,
      sample: {
        slide:
          layout === "explain"
            ? {
                template: "explain",
                fit: "points-0",
                heading: "Roots",
                lead: "Roots take in water.",
                points: [],
              }
            : layout === "picture-sequence"
              ? {
                  template: "picture-sequence",
                  fit: "sequence-3",
                  heading: "A seed grows",
                  sequence: [{ caption: "Seed" }, { caption: "Shoot" }, { caption: "Plant" }],
                }
              : layout === "equation-hero"
                ? {
                    template: "equation-hero",
                    fit: "points-2-fig",
                    heading: "Speed",
                    formula: "s = d / t",
                    points: ["d = 10 m", "t = 2 s"],
                    figure: null,
                  }
                : { template: "title", heading: "Plants", lead: "Year 1 science", picture: null },
      },
    }),
  ),
];

/**
 * Fields a gold template reads and where each comes from: `schema:<field>` (the writer writes it),
 * `code:<who>` (set by code, named) or `gap:<why>` (the gold reads it and nothing can say it yet).
 * `gold-manifest.test.ts` reads each gold's source for `input.<field>` and fails on an undeclared one.
 */
export const GOLD_FIELDS: Record<
  string,
  { files: string[]; layouts: string[]; fields: Record<string, string> }
> = {
  "gold:picture-text": {
    files: ["picture-text.ts"],
    layouts: ["visual-text"],
    fields: {
      template: "code:normalise (visual-text to picture-text)",
      heading: "schema:heading",
      lead: "schema:lead",
      points: "schema:points",
      figure: "schema:figure",
      pictureText:
        "code:toInput (every new picture-text slide; icon and cards from key-card-fig's icon, cards)",
      accentWord: "gap:no accentWord on any visual-text def (schema work, out of scope)",
    },
  },
  "gold:figure": {
    files: ["figure.ts"],
    layouts: ["figure", "big-visual"],
    fields: {
      heading: "schema:heading",
      lead: "schema:caption",
      figure: "schema:figure",
      icon: "schema:icon",
      accentWord: "gap:no accentWord on figure-slide or big-visual (schema work, out of scope)",
    },
  },
  "gold:hinge": {
    files: ["hinge.ts"],
    layouts: ["hinge"],
    fields: {
      heading: "schema:heading",
      options: "schema:options",
      choices: "schema:options",
      correct: "code:answerFirst then the seeded shuffle (fixes.ts, stage.ts)",
      explanation: "code:none (the why lines go to the notes)",
      figure: "code:lent by check-pictures.ts",
      letters: "code:locale",
      stem: "code:resolveAsks (a figure's ask line); the heading is the question",
      accentWord: "gap:no accentWord on hinge (schema work, out of scope; needs a leak check)",
    },
  },
  "gold:practice": {
    files: ["practice.ts"],
    layouts: ["practice"],
    fields: {
      template: "code:toInput",
      heading: "schema:heading",
      questions: "schema:items",
      answers: "schema:items",
      working: "schema:items",
      figure: "schema:picture",
      tile: "code:tiled() in toInput",
    },
  },
  "gold:exit-ticket": {
    files: ["exit-ticket.ts"],
    layouts: ["exit-ticket"],
    fields: {
      heading: "schema:heading",
      questions: "schema:items",
      checkFigure: "code:toInput (a figure lent by check-pictures.ts)",
    },
  },
  "gold:question-set": {
    files: ["question-set.ts"],
    layouts: ["question-set"],
    fields: {
      heading: "schema:heading",
      questions: "schema:items",
      answers: "schema:items",
      working: "schema:items",
      figure: "code:never lent to a quick check (check-pictures.ts)",
    },
  },
  "gold:worked": {
    files: ["worked.ts"],
    layouts: ["worked"],
    fields: {
      heading: "schema:heading",
      lines: "schema:lines",
      check: "schema:check",
      barPanel: "schema:panel",
      vars: "gap:no vars field (an equation in y or n italicises nothing; schema work)",
    },
  },
  "gold:reasons": {
    files: ["reasons.ts"],
    layouts: ["reasons"],
    fields: {
      heading: "schema:heading",
      lead: "schema:lead",
      reasons: "schema:items",
      chain: "schema:kind",
      figure: "schema:picture",
    },
  },
  "gold:stages": {
    files: ["stages.ts"],
    layouts: ["stages"],
    fields: {
      heading: "schema:heading",
      accentWord: "schema:accentWord",
      stages: "schema:items",
      motif: "gap:no motif field on stages (the ordered fallback row would draw it)",
    },
  },
  "gold:steps-model": {
    files: ["steps-model.ts"],
    layouts: ["steps"],
    fields: {
      template: "code:toInput",
      heading: "schema:heading",
      step: "code:the library request adds steps~step-model's step (withLibrary)",
      points: "schema:points",
      figure: "schema:figure",
    },
  },
  "gold:myth": {
    files: ["myth.ts"],
    layouts: ["myth"],
    fields: { heading: "schema:heading", myth: "schema:myth" },
  },
  "gold:items-row": {
    files: ["items-row.ts"],
    layouts: ["items-row"],
    fields: {
      heading: "schema:heading",
      accentWord: "schema:accentWord",
      lead: "schema:lead",
      motif: "schema:motif",
      items: "schema:items",
      ordered: "code:toInput (always false: parts have no order)",
    },
  },
  "gold:panel-list": {
    files: ["panel-list.ts"],
    layouts: ["panel-list"],
    fields: {
      heading: "schema:heading",
      lead: "schema:lead",
      rows: "schema:items",
      panel: "schema:panel",
    },
  },
  "gold:split-compare": {
    files: ["split-compare.ts"],
    layouts: ["split-compare"],
    fields: {
      heading: "schema:heading",
      accentWord: "schema:accentWord",
      sides: "schema:sides",
      marker: "code:the template's default (vs)",
    },
  },
};
