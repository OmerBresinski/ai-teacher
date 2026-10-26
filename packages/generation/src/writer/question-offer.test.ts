import { describe, expect, test } from "bun:test";
import { HINGE_NAMES, layoutTemplate, type Stage, type TemplateInput } from "@tj/slides/templates";
import HINGE_CAP from "@tj/slides/templates/hinge-capacity.json" with { type: "json" };
import PRACTICE from "@tj/slides/templates/practice-capacity.json" with { type: "json" };
import QUICK from "@tj/slides/templates/question-set-capacity.json" with { type: "json" };
import { THEMES } from "@tj/slides/themes";
import l47 from "./bundles/pilot-v4.7/layouts.json" with { type: "json" };
import HINGE from "./hinge-cards.gen.json" with { type: "json" };
import {
  assembleWriterSystem,
  EXIT_TICKET_WRITER_MENU,
  HINGE_WRITER_MENU,
  LAYOUT_WRITER_MENUS,
  MENU_AGE,
  MENU_CHARS_PER_WORD,
  PRACTICE_WRITER_MENU,
  QUESTION_SET_WRITER_MENU,
  questionOffer,
  TILE_WORDS,
} from "./layout-menu";
import { PILOT_PACK_ID, PILOT_PACKS, pilotRequest } from "./pilot-pack";
import type { WriterStage } from "./schema";
import { PROBE_CHARS_PER_WORD } from "./shown-cap";
import { waveCDefs, waveCMenu } from "./wave-c";

/*
 * The question layouts' writer offer (TEACH-110 part v): every number a menu line promises is read
 * back out of the line and checked against the capacity table the template fits with, and the
 * request carries exactly one def per question layout, with nothing they replaced still reachable.
 */
type J = Record<string, any>;
const PUPIL_LINE = "Every line is written for the pupils who read it";
const STAGES: readonly WriterStage[] = ["KS1", "KS2", "KS3-5"];
const KS = { KS1: "KS1", KS2: "KS2", "KS3-5": "KS3" } as const;
const fitsOf = (line: string) =>
  (line.split(" Fits: ")[1] ?? "").replace(/\. Each limit.*$|\.$/, "");
/**
 * "3 to 4 tasks: up to 10 words each" -> [[3,10],[4,10]]. Every clause must parse as a count
 * clause or match one of `other` (the line's non-count clauses); anything else fails the test.
 */
function clauses(fits: string, unit: RegExp, other: RegExp[] = []): [number, number][] {
  const out: [number, number][] = [];
  // Decision 30: counts past WORD_TASK_MAX carry the calculation-only qualifier.
  for (const c of fits
    .replaceAll(", only when every task is a one-line calculation", "")
    .split("; ")) {
    const m = new RegExp(`^(\\d+)(?: to (\\d+))? ${unit.source}: up to (\\d+) words`).exec(c);
    if (!m) {
      if (!other.some((r) => r.test(c))) throw new Error(`unparsed Fits clause: "${c}"`);
      continue;
    }
    const lo = Number(m[1]);
    const hi = Number(m[2] ?? m[1]);
    for (let n = lo; n <= hi; n++) out.push([n, Number(m[3])]);
  }
  return out;
}
/** More items never get a larger budget. */
const monotonic = (pairs: [number, number][]) =>
  pairs.every(([, w], i) => i === 0 || w <= (pairs[i - 1] as [number, number])[1]);
const fitsIn = (words: number, chars: number, stage: WriterStage) =>
  words * MENU_CHARS_PER_WORD[MENU_AGE[stage]] <= chars + 1e-9;

describe("question layout menu lines", () => {
  for (const stage of STAGES) {
    const age = MENU_AGE[stage];
    test(`${stage}: the quick check promises only what its measured cells hold`, () => {
      const table = (QUICK as J)[age];
      const fits = fitsOf(QUESTION_SET_WRITER_MENU[stage]);
      const qs = clauses(fits, /questions?/);
      expect(monotonic(qs)).toBe(true);
      expect(qs.length).toBeGreaterThan(0);
      for (const [n, w] of qs) {
        expect(table[String(n)], `${stage} ${n} questions`).toBeDefined();
        // Ordinary words (the probe's and the gold's 5.4 a word) fit the comfortable one-line cap;
        // long words (the stage's p80 rate) never pass the hard max: tight at worst, never over.
        const cell = table[String(n)].questions;
        expect(w * PROBE_CHARS_PER_WORD, `${stage} ${n}: comfortable`).toBeLessThanOrEqual(
          cell.cap + 1,
        );
        expect(fitsIn(w, cell.hardMax, stage), `${stage} ${n}: never over`).toBe(true);
      }
      for (const c of fits.split("; ")) {
        const m =
          /^(\d+)(?: to (\d+))? questions: .*each answer (?:up to (\d+) words|one word or number)/.exec(
            c,
          );
        if (!m) continue;
        for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n++)
          expect(fitsIn(Number(m[3] ?? 1), table[String(n)].answers.cap, stage)).toBe(true);
      }
      const [lo, hi] = questionOffer(stage)["question-set"];
      expect(qs.map(([n]) => n)).toEqual(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
    });
    test(`${stage}: practice and the exit ticket promise only what their measured cells hold`, () => {
      const t = (PRACTICE as J)[age];
      const line = PRACTICE_WRITER_MENU[stage];
      const [plain, pic] = fitsOf(line).split("; with a picture or diagram: ");
      const cell = (k: string, n: number) => t[k].find((c: J) => c.n === n)?.cap as number;
      const pl = clauses(plain ?? "", /tasks?/);
      expect(monotonic(pl)).toBe(true);
      for (const [n, w] of pl) expect(fitsIn(w, cell("practice", n), stage)).toBe(true);
      for (const [n, w] of clauses(pic ?? "", /tasks?/)) {
        expect(fitsIn(w, cell("practice+picture", n), stage)).toBe(true);
        expect(fitsIn(w, cell("practice+figure", n), stage)).toBe(true);
      }
      const exit = clauses(fitsOf(EXIT_TICKET_WRITER_MENU[stage]), /questions?/);
      // From 1, contiguous; a count whose shown cap goes under the floor or halves is dropped.
      expect(exit.map(([n]) => n)).toEqual(exit.map((_, i) => i + 1));
      expect(monotonic(exit)).toBe(true);
      for (const [n, w] of exit) expect(fitsIn(w, cell("exit", n), stage)).toBe(true);
    });
    test(`${stage}: the hinge promises only what #539's measured table holds`, () => {
      const cap = (HINGE_CAP as J)[age];
      const fits = fitsOf(HINGE_WRITER_MENU[stage]);
      const q = Number(/the question up to (\d+) words/.exec(fits)?.[1]);
      expect(fitsIn(q, (HINGE as J).groups[stage].stem, stage)).toBe(true);
      const opts = clauses(fits, /options?/, [
        /^the question up to \d+ words$/,
        new RegExp(`^options with icons: up to ${TILE_WORDS} words each$`),
      ]);
      expect(opts.map(([n]) => n)).toEqual(
        Array.from({ length: cap.options - 1 }, (_, i) => i + 2),
      );
      expect(monotonic(opts)).toBe(true);
      // Each option count against its own measured cell (18 Oct 2026), else the most-options one.
      for (const [n, w] of opts)
        expect(w).toBeLessThanOrEqual((cap.byCount?.[String(n)] ?? cap).words);
    });
    test(`${stage}: a full row of picture tiles named in ${TILE_WORDS} words fits on every theme`, () => {
      const cap = (HINGE_CAP as J)[age];
      const names = ["Green leaf", "Long root", "Bright flower", "Tall stem"].slice(0, cap.options);
      const icons = ["leaf", "root", "flower", "stem"];
      const ks = ({ KS1: "ks1", KS2: "ks2", "KS3-5": "ks3" } as const)[stage] as Stage;
      for (const theme of THEMES) {
        const r = layoutTemplate(
          {
            template: "hinge",
            heading: "Which part takes in water from the soil?",
            options: names,
            choices: names.map((text, i) => ({ text, icon: icons[i] })),
            correct: 2,
          } as TemplateInput,
          theme,
          ks,
        );
        expect(r.over, `${stage} ${theme.id}`).toEqual([]);
        // Tiles, not the word-card fallback: every option drew its icon.
        const drawn = (r.slide.elements as { name?: string }[]).filter(
          (e) => e.name === HINGE_NAMES.icon,
        );
        expect(drawn).toHaveLength(names.length);
      }
    });
  }
});

describe(`pilot pack ${PILOT_PACK_ID}: the question layouts`, () => {
  test("production runs v4.13", () => {
    expect(PILOT_PACK_ID).toBe("v4.13");
  });
  for (const stage of STAGES) {
    const req = pilotRequest(PILOT_PACK_ID, KS[stage], {}, (sc) => sc);
    const defs = req.schema.$defs as J;
    const refs = (req.schema.properties.slides.items.anyOf as J[]).map((r) =>
      String(r.$ref).split("/").pop(),
    );
    test(`${stage}: one def per question layout, its counts the menu's, no string caps`, () => {
      for (const k of ["hinge", "question-set", "practice", "exit-ticket"]) {
        expect(refs).toContain(k);
        expect(refs.some((r) => r?.startsWith(`${k}~`))).toBe(false);
      }
      expect(refs).not.toContain("choose");
      expect(JSON.stringify(req.schema)).not.toContain("maxLength");
      const o = questionOffer(stage);
      expect([
        defs.hinge.properties.options.minItems,
        defs.hinge.properties.options.maxItems,
      ]).toEqual([...o.hinge]);
      for (const k of ["question-set", "practice", "exit-ticket"] as const)
        expect([defs[k].properties.items.minItems, defs[k].properties.items.maxItems]).toEqual([
          ...o[k],
        ]);
      expect(defs.hinge.properties.correct).toBeUndefined();
      expect(defs["items-row"].properties.ordered).toBeUndefined();
    });
    test(`${stage}: every $ref resolves and every object is closed with every key required`, () => {
      const walk = (n: unknown): void => {
        if (Array.isArray(n)) {
          for (const x of n) walk(x);
          return;
        }
        if (!n || typeof n !== "object") return;
        const o = n as J;
        if (typeof o.$ref === "string") expect(defs[o.$ref.replace("#/$defs/", "")]).toBeDefined();
        if (o.type === "object" && o.properties) {
          expect(o.additionalProperties).toBe(false);
          expect([...o.required].sort()).toEqual(Object.keys(o.properties).sort());
        }
        for (const v of Object.values(o)) walk(v);
      };
      for (const k of ["hinge", "question-set", "practice", "exit-ticket"]) walk(defs[k]);
    });
    test(`${stage}: the system text offers the new lines once and no choose`, () => {
      const sys = req.system;
      for (const k of ["hinge", "question-set", "practice", "exit-ticket"])
        expect(sys.split(`\n- ${k}: `).length).toBe(2);
      expect(sys).not.toContain("\n- choose: ");
      expect(sys.split("\nAnswers on question-set, practice and exit-ticket").length).toBe(2);
      // Every fill shape names only keys its def has (items-row lost \`ordered\`, ruling 227).
      for (const line of sys.split("\n").filter((l) => l.startsWith('{"template":"'))) {
        const shape = JSON.parse(line) as J;
        const def = defs[shape.template];
        if (!def?.properties) continue;
        for (const k of Object.keys(shape))
          expect(def.properties[k], `${shape.template}.${k}`).toBeDefined();
      }
    });
  }
  test("the request is smaller than v4.6's: the per-count twins go", () => {
    for (const ks of ["KS1", "KS2", "KS3"] as const) {
      // The panel-list line is left out: its numbers follow the measured table (TEACH-205 part d
      // shortened the side title), not the question layouts this compares.
      // v4.7's line is cut by the menu's own text; v4.6 is frozen text with no builder, so its
      // line goes by prefix. Each cut must remove exactly one line, so neither can miss silently.
      const line = LAYOUT_WRITER_MENUS["panel-list"][ks === "KS3" ? "KS3-5" : ks];
      const size = (id: "v4.6" | typeof PILOT_PACK_ID) => {
        const r = pilotRequest(id, ks, {}, (sc) => sc);
        // Wave C (TEACH-110 part v) is new teaching layouts, not the question layouts: left out.
        const st = ks === "KS3" ? "KS3-5" : ks;
        const waveLines = new Set(Object.values(waveCMenu(st)));
        // v4.11 and v4.12 lengthened prose rules (wording, not a question layout): each changed
        // line is replaced by v4.10's line with the same opening, so only that delta is left out;
        // its own caps are the tests below.
        const old = PILOT_PACKS["v4.10"].system[ks].split("\n");
        const was = (l: string) =>
          id === "v4.6" || old.includes(l)
            ? l
            : (old.find((o) => o.slice(0, 24) === l.slice(0, 24)) ?? l);
        const lines = r.system
          .split("\n")
          .filter((l) => !waveLines.has(l))
          .map(was);
        const kept = lines.filter((l) =>
          id !== "v4.6" ? l !== line : !l.startsWith("- panel-list: "),
        );
        expect(lines.length - kept.length, `${id} ${ks}: one panel-list line`).toBe(1);
        const schema = structuredClone(r.schema);
        for (const k of Object.keys(waveCDefs(st, true))) delete schema.$defs[k];
        return kept.join("\n").length + JSON.stringify(schema).length;
      };
      expect(size(PILOT_PACK_ID)).toBeLessThan(size("v4.6"));
    }
  });
  test("v4.11's pupil-line rule grows v4.10's by at most 900 characters at each key stage", () => {
    for (const ks of ["KS1", "KS2", "KS3"] as const) {
      const pupil = (v: "v4.10" | "v4.11") =>
        PILOT_PACKS[v].system[ks].split("\n").find((l) => l.startsWith(PUPIL_LINE)) as string;
      expect(pupil("v4.11").length - pupil("v4.10").length).toBeGreaterThan(0);
      expect(pupil("v4.11").length - pupil("v4.10").length).toBeLessThanOrEqual(900);
    }
  });
  test("v4.12's wording grows v4.11's by at most 2,300 characters at each key stage", () => {
    for (const ks of ["KS1", "KS2", "KS3"] as const) {
      const grow = PILOT_PACKS["v4.12"].system[ks].length - PILOT_PACKS["v4.11"].system[ks].length;
      expect(grow).toBeGreaterThan(0);
      expect(grow).toBeLessThanOrEqual(2300);
    }
  });
  test("v4.13's wording grows v4.12's by at most 800 characters at each key stage", () => {
    for (const ks of ["KS1", "KS2", "KS3"] as const) {
      const grow = PILOT_PACKS["v4.13"].system[ks].length - PILOT_PACKS["v4.12"].system[ks].length;
      expect(grow).toBeGreaterThan(0);
      expect(grow).toBeLessThanOrEqual(800);
    }
  });
  test("every flowShapeRoutes shape is a flow shape, and each routed layout's line names its shapes", () => {
    const L = l47 as unknown as { flowShapes: string[]; flowShapeRoutes: Record<string, string[]> };
    const menus = LAYOUT_WRITER_MENUS as Record<string, Record<WriterStage, string>>;
    for (const [layout, shapes] of Object.entries(L.flowShapeRoutes)) {
      for (const sh of shapes) expect(L.flowShapes).toContain(sh);
      for (const stage of STAGES)
        expect(menus[layout]?.[stage]).toContain(`(flow shape ${shapes.join(" or ")})`);
    }
    expect(Object.keys(L.flowShapeRoutes).sort()).toEqual(Object.keys(menus).sort());
  });
  test("the answers rule's word limits are the end Answers ledger's own", async () => {
    const { answerItem, SHORT_ANSWER_WORDS } = await import("@tj/slides/templates/end-answers");
    const cap = (await import("@tj/slides/templates/end-answers-capacity.json")).default as J;
    const { ANSWERS_RULE } = await import("./layout-menu");
    const short = Number(/a phrase of up to (\d+) words/.exec(ANSWERS_RULE)?.[1]);
    const sentence = Number(/one model sentence of up to (\d+) words/.exec(ANSWERS_RULE)?.[1]);
    expect(short).toBe(SHORT_ANSWER_WORDS);
    // A short answer at the limit stays a short answer in the ledger; one word more is a sentence.
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    expect("a" in answerItem(1, words(short))).toBe(true);
    expect("s" in answerItem(1, words(short + 1))).toBe(true);
    // The sentence limit is a sentence class the ledger's capacity table measures at every stage.
    for (const stage of Object.keys(cap))
      expect(cap[stage][`${sentence}-word sentences`]).toBeGreaterThan(0);
    // A lesson saved with the old " — " join is read back as answer plus working.
    expect(answerItem(1, "20 m/s — 100 ÷ 5 = 20")).toEqual({
      n: 1,
      a: "20 m/s",
      work: "100 ÷ 5 = 20",
    });
    expect(ANSWERS_RULE).not.toMatch(/working, up to \d+/);
  });
  test("the answers rule slot is required exactly once", () => {
    const t = PILOT_PACKS[PILOT_PACK_ID].system.KS2;
    expect(t).toContain("Answers on question-set");
    expect(() => assembleWriterSystem("{{menu:items-row}}", "KS2")).toThrow();
  });
});

describe("the writer's question items reach the templates", () => {
  const ctx = { visual: () => ({ status: "pending" as const }) } as never;
  test("practice and exit answers travel with their questions; working stays its own field", async () => {
    const { toInput } = await import("./materialise");
    const slide = {
      template: "practice",
      heading: "Speed",
      picture: null,
      items: [
        {
          question: "A car goes 100 m in 5 s. Find its speed.",
          answer: "20 m/s",
          working: "100 ÷ 5 = 20",
        },
        {
          question: "Explain why speed has a unit.",
          answer: "It compares distance with time — so both units show.",
          working: null,
        },
      ],
    };
    const input = toInput(slide, ctx) as J;
    expect(input.questions).toEqual(slide.items.map((i) => i.question));
    expect(input.answers).toEqual([
      "20 m/s",
      "It compares distance with time, so both units show.",
    ]);
    expect(input.working).toEqual(["100 ÷ 5 = 20", ""]);
  });
  test("a hinge's option objects become its options, and its question is the heading", async () => {
    const { toInput, questionsOf } = await import("./materialise");
    const slide = {
      template: "hinge",
      heading: "Which carries blood away from the heart?",
      options: [
        { text: "Artery", icon: "artery", why: null },
        { text: "Vein", icon: "vein", why: "Thinks every vessel leaves the heart." },
      ],
      correct: 1,
    };
    const input = toInput(slide, ctx) as J;
    expect(input.options).toEqual(["Artery", "Vein"]);
    // Picture tiles and the teacher-note whys reach #539's template input.
    expect(input.choices).toEqual([
      { text: "Artery", icon: "artery" },
      { text: "Vein", icon: "vein", why: "Thinks every vessel leaves the heart." },
    ]);
    expect(questionsOf(slide)).toEqual([slide.heading]);
  });
  test("a long practice slide splits by its items", async () => {
    const { continuePractice } = await import("./practice-split");
    const items = Array.from({ length: 8 }, (_, i) => ({
      question: `Q${i}`,
      answer: `${i}`,
      working: null,
    }));
    const r = continuePractice(
      { template: "practice", heading: "H", items },
      (s) => (s.items as unknown[]).length <= 4,
    );
    expect(r?.first.items).toEqual(items.slice(0, 4));
    expect(r?.rest[0]?.items).toEqual(items.slice(4));
  });
});

describe("the quick check's question length is its Fits", () => {
  // The line count differs by stage (KS2 one line; KS1 and KS3 up to two, TEACH-215 part j), and a
  // fixed "fits one line" contradicted the KS1 and KS3 Fits. The Fits' words carry the length, so
  // the line names no line count at any stage (TEACH-110 part ae, 19 Oct 2026).
  for (const stage of ["KS1", "KS2", "KS3-5"] as const)
    test(`${stage}: no line count beside the Fits`, () => {
      const line = QUESTION_SET_WRITER_MENU[stage];
      expect(line).not.toMatch(/\b(one|two|a single) lines?\b/i);
      expect(line).toContain("Each answer is a number, a word or a short phrase.");
      expect(line).toMatch(/Fits: .*up to \d+ words each/);
    });
});
