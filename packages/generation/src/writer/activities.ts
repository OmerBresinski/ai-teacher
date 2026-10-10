import type { RichDoc, Slide, SlideElement } from "@tj/domain/documents";
import { LEAKS } from "@tj/slides/templates/activities";
import CAPACITY from "@tj/slides/templates/activity-capacity.json" with { type: "json" };
import MENU from "./bundles/base4f-p123/activity-menu.txt" with { type: "text" };
import type { WriterStage } from "./schema";

/*
 * The activity templates (TEACH-101 part b) as writer layouts (TEACH-101 part c), behind
 * `WriterRun.activities` (default off): the schema defs per family, bounded per key stage from the
 * templates' own measured capacities; the writer's activity slide mapped onto the template's input
 * (1-based indices to 0-based, a card's picture phrase to a one-subject picture ask); the code
 * repair for what strict mode cannot bound (card words over the measured cell); and the checks a
 * laid-out activity must pass (the seeded shuffles give nothing away, no answer shows in the
 * question state).
 *
 * `label` is not offered: its pointers need the drawn parts' positions, and neither the drawer nor
 * the library returns label anchors (a drawn diagram is an SVG string). The template stays for
 * hand-made slides.
 */

type S = Record<string, unknown>;
type J = Record<string, unknown>;

/** The families the writer may choose (label held back: no label anchors from the drawer). */
export const WRITER_ACTIVITIES = [
  "pair",
  "group-sort",
  "sequence",
  "choose",
  "odd-one-out",
] as const;
export type WriterActivity = (typeof WRITER_ACTIVITIES)[number];
export const isWriterActivity = (t: unknown): t is WriterActivity =>
  (WRITER_ACTIVITIES as readonly unknown[]).includes(t);

/** The production default: the writer's menu has no activities until the gate is turned on. */
export const ACTIVITIES_DEFAULT = false;

/** A measured variant is offered only when its card words can be this long (the menu's rule). */
export const MIN_CELL = 8;

type Variant = { cards: number; groups?: number; chars: number };
const TABLE = CAPACITY as unknown as Record<string, Record<string, Record<string, number>>>;

/** The kept variants of one family at one stage: cell of at least `MIN_CELL` characters. */
export function variants(id: WriterActivity, stage: WriterStage): Variant[] {
  const row = TABLE[id]?.[stage] ?? {};
  return Object.entries(row)
    .map(([label, chars]) => {
      const cards = Number(label.match(/^(\d+) cards/)?.[1]);
      const groups = Number(label.match(/(\d+) groups/)?.[1]) || undefined;
      return { cards, ...(groups ? { groups } : {}), chars };
    })
    .filter((v) => Number.isInteger(v.cards) && v.chars >= MIN_CELL)
    .sort((a, b) => a.cards - b.cards || (a.groups ?? 0) - (b.groups ?? 0));
}

/** Card and group bounds for the schema (inclusive) and the longest card word at any kept count. */
export function bounds(id: WriterActivity, stage: WriterStage) {
  const v = variants(id, stage);
  const counts = v.map((x) => x.cards);
  const groups = v.flatMap((x) => (x.groups ? [x.groups] : []));
  return {
    cards: [Math.min(...counts), Math.max(...counts)] as [number, number],
    ...(groups.length
      ? { groups: [Math.min(...groups), Math.max(...groups)] as [number, number] }
      : {}),
    chars: Math.max(...v.map((x) => x.chars)),
  };
}

/** The longest card word `n` cards hold at this stage (the least over its kept group variants). */
export function cellFor(id: WriterActivity, stage: WriterStage, n: number): number {
  const at = variants(id, stage).filter((v) => v.cards === n);
  if (at.length) return Math.min(...at.map((v) => v.chars));
  // An unmeasured count inside the range (7 cards in a group sort): the nearer measured one below.
  const below = variants(id, stage).filter((v) => v.cards < n);
  return below.length ? Math.min(...below.map((v) => v.chars)) : 0;
}

/* ------------------------------------------------------------------ */
/* The menu text                                                       */
/* ------------------------------------------------------------------ */

const orWords = (xs: number[]) => {
  const u = [...new Set(xs)].sort((a, b) => a - b);
  return u.length === 1 ? `${u[0]}` : `${u.slice(0, -1).join(", ")} or ${u.at(-1)}`;
};

/** One family's `Fits:` clause at a stage, rendered from the capacity table (never hand-copied). */
export function fitsLine(id: WriterActivity, stage: WriterStage): string {
  const v = variants(id, stage);
  if (id === "group-sort") {
    const cards = [...new Set(v.map((x) => x.cards))];
    const lo = Math.min(...cards);
    const hi = Math.max(...cards);
    const n = lo === hi ? `${lo}` : `${lo} to ${hi}`;
    return `${n} cards in ${orWords(v.map((x) => x.groups ?? 0))} groups, labels up to ${Math.min(...v.map((x) => x.chars))} characters`;
  }
  return v
    .map((x, k) =>
      k === 0
        ? `${x.cards} cards, labels up to ${x.chars} characters`
        : `${x.cards} cards, ${x.chars}`,
    )
    .join("; ");
}

/** The menu for one stage: the prompt engineer's text, `{fits.*}` filled, families offered only. */
export function activityMenu(stage: WriterStage, menu: string = MENU): string {
  const offered = (line: string) => {
    const id = line.match(/^- ([a-z-]+):/)?.[1];
    return !id || isWriterActivity(id);
  };
  return menu
    .split("\n")
    .filter(offered)
    .join("\n")
    .replace(/\{fits\.([a-z-]+)\}/g, (_, id: string) =>
      isWriterActivity(id) ? fitsLine(id, stage) : "",
    )
    .trim();
}

/** The writer's system text with the activity menu after the last layout (before the pictures). */
export function withActivityMenu(system: string, stage: WriterStage, menu?: string): string {
  const at = system.indexOf("\n\nPictures and diagrams:");
  if (at < 0) throw new Error("no Pictures and diagrams section in the writer's system text");
  return `${system.slice(0, at)}\n\n${activityMenu(stage, menu)}${system.slice(at)}`;
}

/* ------------------------------------------------------------------ */
/* The schema                                                          */
/* ------------------------------------------------------------------ */

const S_ = (): J => ({ type: "string" });
const NUL = (x: J): J => ({ anyOf: [x, { type: "null" }] });
const REF = (n: string): J => ({ $ref: `#/$defs/${n}` });
const obj = (props: J): J => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(props),
  properties: props,
});
const arr = (items: J, lo: number, hi: number): J => ({
  type: "array",
  items,
  minItems: lo,
  maxItems: hi,
});

/** The five families' defs at one stage (strict: every key required, optional ones nullable). */
export function activityDefs(stage: WriterStage): Record<string, J> {
  const defs: Record<string, J> = {};
  for (const id of WRITER_ACTIVITIES) {
    const b = bounds(id, stage);
    // The longest card word at any kept count; strict mode takes `pattern` (not `maxLength`), and
    // the count's own cell is code's (`fromWriterActivity`).
    const label = { type: "string", pattern: `^.{1,${b.chars}}$` };
    // pair: every card has a picture (its own card shape); the others may be word cards.
    const card: J = obj({
      label,
      picture: id === "pair" ? S_() : NUL(S_()),
      ...(id === "group-sort"
        ? { group: { type: "integer", minimum: 1, maximum: b.groups?.[1] ?? 2 } }
        : {}),
    });
    const head = {
      template: { type: "string", enum: [id] },
      heading: S_(),
      instruction: NUL(S_()),
    };
    const cards = arr(card, b.cards[0], b.cards[1]);
    defs[id] =
      id === "group-sort"
        ? obj({ ...head, groups: arr(S_(), b.groups?.[0] ?? 2, b.groups?.[1] ?? 2), cards })
        : id === "choose"
          ? obj({
              ...head,
              cards,
              correct: { type: "integer", minimum: 1, maximum: b.cards[1] },
              explanation: NUL(S_()),
            })
          : id === "odd-one-out"
            ? obj({
                ...head,
                cards,
                correct: { type: "integer", minimum: 1, maximum: b.cards[1] },
                explanation: S_(),
              })
            : obj({ ...head, cards });
  }
  return defs;
}

/** The writer schema with the activity layouts in `slides` and `cards` as a flow look. */
export function withActivities(schema: J, stage: WriterStage): J {
  const s = JSON.parse(JSON.stringify(schema)) as J;
  const defs = s.$defs as Record<string, J>;
  const props = s.properties as Record<string, J>;
  const slides = (props.slides as J).items as { anyOf: J[] };
  for (const [id, def] of Object.entries(activityDefs(stage))) {
    if (defs[id]) throw new Error(`writer schema already has a ${id} def`);
    defs[id] = def;
    slides.anyOf.push(REF(id));
  }
  const look = (((props.flow as J).items as J).properties as Record<string, J>).look_at as J;
  const kind = (look.properties as Record<string, J>).kind as { enum: string[] };
  if (!kind.enum.includes("cards")) kind.enum = [...kind.enum, "cards"];
  return s;
}

/* ------------------------------------------------------------------ */
/* Mapping and code repair                                             */
/* ------------------------------------------------------------------ */

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * The writer's activity slide as the template's input shape (what `materialise` reads): labels to
 * `text`, a picture phrase to a one-subject picture ask, 1-based group and correct to 0-based /
 * kept, and the instruction to the lead. Counts past the stage's bounds and card words past the
 * measured cell are repaired here (fewer cards, never smaller words); what code cannot repair is
 * left for the layout's `over` marks. Returns the slide and what was fixed, for the log.
 */
export function fromWriterActivity(
  raw: S,
  stage: WriterStage,
  lessonSubject = "",
): { slide: S; fixes: string[]; converted?: string } {
  const id = raw.template as WriterActivity;
  const fixes: string[] = [];
  const asks = id === "choose" || id === "odd-one-out";
  const raws = Array.isArray(raw.cards) ? (raw.cards as S[]) : [];
  /**
   * An activity whose answer is wrong or missing never ships: it becomes a plain content slide
   * (the heading, the instruction and the cards' words as points) and the stage logs why.
   */
  const plain = (why: string) => ({
    slide: {
      template: "explain",
      heading: str(raw.heading),
      lead: str(raw.instruction),
      points: raws.map((c) => str(c?.label)).filter(Boolean),
    } as S,
    fixes: [...fixes, why],
    converted: why,
  });
  const b = bounds(id, stage);
  const groups = Array.isArray(raw.groups) ? raw.groups.map(str).filter(Boolean) : [];
  type Card = { text: string; picture?: string; group?: number; answer: boolean; bad?: boolean };
  const correct = Number(raw.correct);
  if (asks && !(Number.isInteger(correct) && correct >= 1 && correct <= raws.length))
    return plain(`correct ${String(raw.correct)} out of range`);
  let cards: Card[] = (Array.isArray(raw.cards) ? (raw.cards as S[]) : []).flatMap(
    (c, k): Card[] => {
      const text = str(c?.label);
      if (!text) {
        fixes.push(`card ${k + 1} empty`);
        return [];
      }
      const g = Number(c?.group);
      const group = id === "group-sort" ? g - 1 : undefined;
      if (
        group !== undefined &&
        !(Number.isInteger(group) && group >= 0 && group < groups.length)
      ) {
        fixes.push(`card ${k + 1} in no group`);
        return [{ text, answer: false, bad: true }];
      }
      const picture = str(c?.picture) || undefined;
      return [
        {
          text,
          ...(picture ? { picture } : {}),
          ...(group !== undefined ? { group } : {}),
          answer: k === correct - 1,
        },
      ];
    },
  );
  if (cards.some((c) => c.bad)) return plain("group out of range");
  if (asks && !cards.some((c) => c.answer)) return plain("the correct card is empty");
  /** Drops one card code may lose: never the answer, in a group sort from the fullest group. */
  const dropOne = (): boolean => {
    let at = -1;
    if (id === "group-sort") {
      const size = (g: number) => cards.filter((c) => c.group === g).length;
      const fullest = [...groups.keys()].sort((a, b2) => size(b2) - size(a))[0];
      if (fullest === undefined || size(fullest) < 2) return false;
      at = cards.map((c) => c.group).lastIndexOf(fullest);
    } else at = cards.map((c) => c.answer).lastIndexOf(false);
    if (at < 0) return false;
    cards = cards.filter((_, k) => k !== at);
    return true;
  };
  while (cards.length > b.cards[1] && dropOne()) fixes.push(`cards over ${b.cards[1]}`);
  // A word longer than the count's cell: fewer cards when a smaller kept count holds it.
  const longest = () => Math.max(0, ...cards.map((c) => c.text.length));
  while (
    cards.length > b.cards[0] &&
    longest() > cellFor(id, stage, cards.length) &&
    longest() <= cellFor(id, stage, cards.length - 1) &&
    dropOne()
  )
    fixes.push(`card words over ${cellFor(id, stage, cards.length + 1)} characters`);
  if (cards.length < b.cards[0]) return plain(`cards under ${b.cards[0]}`);
  if (id === "group-sort" && groups.some((_, g) => !cards.some((c) => c.group === g)))
    return plain("a group with no cards");
  const right = cards.findIndex((c) => c.answer);
  // Ruling 163: a history lesson's card, or a card naming a person, place or thing (a capitalised
  // word after the first), is a named subject: a real picture or its word, never generated.
  const named = (p: string) =>
    /^hist/i.test(lessonSubject) ||
    /\s(?!I\b)[A-Z][a-z]/.test(` ${p.split(/\s+/).slice(1).join(" ")}`);
  const slide: S = {
    template: id,
    heading: str(raw.heading),
    ...(str(raw.instruction) ? { lead: str(raw.instruction) } : {}),
    cards: cards.map((c) => ({
      text: c.text,
      ...(c.picture
        ? {
            picture: {
              shows: c.picture,
              must_see: [c.picture],
              subject: named(c.picture) ? "named" : "generic",
            },
          }
        : {}),
      ...(c.group !== undefined ? { group: c.group } : {}),
    })),
    ...(id === "group-sort" ? { groups } : {}),
    ...(id === "choose" || id === "odd-one-out"
      ? {
          correct: right + 1,
          ...(str(raw.explanation) ? { explanation: str(raw.explanation) } : {}),
        }
      : {}),
  };
  return { slide, fixes };
}

/* ------------------------------------------------------------------ */
/* Checks on the laid-out slide                                        */
/* ------------------------------------------------------------------ */

const docText = (d: unknown): string => {
  if (!d || typeof d !== "object") return "";
  const o = d as { text?: unknown; content?: unknown[] };
  const own = typeof o.text === "string" ? o.text : "";
  return own + (Array.isArray(o.content) ? o.content.map(docText).join(" ") : "");
};
/** An element's visible words (a text box's doc). */
export const elementText = (e: SlideElement): string =>
  e.type === "text" ? docText((e as { doc?: RichDoc }).doc).trim() : "";
const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/\*\*/g, "")
    .replace(/^\s*\d+\s+/, "")
    .replace(/[^a-z0-9/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const centre = (e: { x: number; y: number; w: number; h: number }) => ({
  x: e.x + e.w / 2,
  y: e.y + e.h / 2,
});
/**
 * Reading order of boxes: rows top to bottom, then left to right. A card's marker or words sit at
 * different heights on a picture card and a word card, so a new row starts only past `gap` points.
 */
const reading = (bs: { x: number; y: number; w: number; h: number }[], gap = 90) => {
  const cs = bs.map((b, i) => ({ c: centre(b), i })).sort((a, b) => a.c.y - b.c.y);
  let row = 0;
  const rows = cs.map((x, k) => {
    if (k > 0 && x.c.y - (cs[k - 1] as { c: { y: number } }).c.y > gap) row += 1;
    return { ...x, row };
  });
  return rows.sort((a, b) => a.row - b.row || a.c.x - b.c.x).map(({ i }) => i);
};
const hasWord = (hay: string, needle: string) =>
  needle.length >= 3 &&
  new RegExp(`(^|[^a-z0-9])${needle.replace(/[/]/g, "\\/")}($|[^a-z0-9])`).test(hay);

/**
 * The faults of one laid-out activity (`leak:` and `activity:` kinds): the shown order gives the
 * answer away, an answer is visible in the question state, or the answer is missing. Dangling
 * "look at" lines are the shared check's (`checkSlide`), over the same words.
 */
export function activityFaults(
  s: S | undefined,
  laid: Pick<Slide, "elements" | "question"> | undefined,
): string[] {
  if (!s || !laid || !isWriterActivity(s.template)) return [];
  const id = s.template as WriterActivity;
  const out: string[] = [];
  const cards = (Array.isArray(s.cards) ? s.cards : []) as { text: string; group?: number }[];
  const q = laid.question;
  // Ruling 195: a pair whose card pictures failed is laid as plain questions, with nothing to reveal.
  if (!q && id === "pair" && !laid.elements.some((e) => e.type === "image")) return [];
  if (!q) return ["activity: no answer to reveal"];
  const els = laid.elements;
  const byId = new Map(els.map((e) => [e.id, e]));
  const texts = els.filter((e) => e.type === "text").map((e) => ({ e, t: norm(elementText(e)) }));
  // Where each card's words sit on the slide, by written index.
  const at = cards.map((c) => texts.find((x) => x.t === norm(c.text))?.e);
  const shownOrder = () => {
    if (at.some((e) => !e)) return undefined;
    // order[slot] = the written card shown in that slot.
    return reading(at as SlideElement[]);
  };
  if (id === "pair") {
    const pairs =
      q.type === "image-match"
        ? q.pairs.map((p) => [p.imageId, p.labelId])
        : q.type === "matching"
          ? q.pairs.map((p) => [p.leftElementId, p.rightElementId])
          : [];
    if (!pairs.length) out.push("activity: pair without its pairs");
    for (const [a, b] of pairs) {
      const A = byId.get(a ?? "");
      const B = byId.get(b ?? "");
      if (A && B && Math.abs(centre(A).x - centre(B).x) < 2)
        out.push("leak: a pair's word sits under its own picture");
    }
  } else if (id === "sequence") {
    const order = q.type === "sort" ? q.order.map((x) => byId.get(x)) : [];
    if (order.length !== cards.length || order.some((e) => !e))
      out.push("activity: sequence without its order");
    else {
      // shown[slot] = the step shown in that slot.
      if (LEAKS.sequence(reading(order as SlideElement[])))
        out.push("leak: the sequence is shown in order, reversed or part-placed");
    }
  } else if (id === "group-sort") {
    const order = shownOrder();
    if (order && LEAKS.groups(order.map((k) => cards[k]?.group ?? -1)))
      out.push("leak: a group's cards sit side by side");
    if (q.type === "fill-gap")
      for (const g of q.gaps) {
        const e = byId.get(g.id);
        if (e && g.answer && norm(elementText(e)) === norm(g.answer))
          out.push("leak: a group's answer is written in its gap");
      }
  } else {
    const order = shownOrder();
    if (order && LEAKS.choose(order)) out.push("leak: the options are shown in the order written");
    if (q.type !== "multiple-choice" || !q.options.some((o) => o.correct))
      out.push(`activity: ${id} without a correct card`);
    const right = cards[Number(s.correct) - 1]?.text;
    const ask = norm(`${String(s.heading ?? "")} ${String(s.lead ?? "")}`);
    if (right && hasWord(ask, norm(right)))
      out.push(`leak: the answer "${right}" is in the heading or instruction`);
  }
  // The reveal-only words (the odd one's reason, a choose explanation) never show as a question.
  const why = norm(String(s.explanation ?? ""));
  if (why && texts.some((x) => x.t.includes(why)))
    out.push("leak: the explanation is on the slide");
  return out;
}

/** The activity's words for the shared checks (dangling, duplicates): heading, lead and cards. */
export function activityWords(s: S): string[] {
  if (!isWriterActivity(s.template)) return [];
  const cards = (Array.isArray(s.cards) ? s.cards : []) as { text?: string }[];
  const groups = (Array.isArray(s.groups) ? s.groups : []) as string[];
  return [...cards.map((c) => String(c.text ?? "")), ...groups];
}
