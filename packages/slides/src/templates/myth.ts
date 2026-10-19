/**
 * Myth and fact (TEACH-75 part ag, layout batch G1; rulings 224, 238, 245, 247): a misconception
 * (or a surprising truth) as a calm "True or false?" slide. Ported from the pilot's
 * `northstars-v12/myth-c` (Greg 15 Oct, "yes, build it"); the pilot's px at 1440 are x 2/3 here.
 *
 * - One frame: the title, a sand claim panel on the left, a round seam arrow, and the fact panel on
 *   the right (its label, the fact as the hero, one small proof at the foot).
 * - `opening: "vote"` (default) has three clicks: 0 the claim alone on a sand card across the stage
 *   with "True or false?" and two neutral chips; 1 the verdict (the claim settled in the panel,
 *   stamped MYTH and struck, or TRUE and left in ink); 2 the fact and its proof. The vote is a
 *   prompt, never the lesson's check: the slide carries no question. `opening: "straight"` starts
 *   at the verdict (always myth) and has two.
 * - Reveals only add: the verdict step paints the ground and the claim panel over the card, so a
 *   step never needs a hide. The myth strike is a run attribute (`strikeStep`, TEACH-205 part c:
 *   an offset line at 0.25em, 0.075em thick) shown on the verdict's click.
 * - Proof: a line (muted, a `**…**` payoff in ink bold) with at most one visual: 1-2 library icons
 *   in medals or one picture. A missed icon is dropped; a failed picture leaves the line alone; no
 *   proof leaves the label and the fact. The pilot's older `same`/`change`/`one` proof diagrams
 *   are left out (myth-c "calmer").
 * - Fit (myth-c NOTES): the fact steps down to the name floor, the panel claim to the body floor,
 *   the open claim keeps to 3 lines and goes no smaller than the name size. Still over: the field is
 *   named in `over`, words are never cut.
 */
import type {
  ImageElement,
  PathElement,
  RichDoc,
  RichNode,
  ShapeElement,
  SlideElement,
  TextElement,
  TextPreset,
} from "@tj/domain/documents";
import { styledRun } from "@tj/domain/documents";
import { contrastRatio } from "../colour-contrast";
import { uid } from "../factories";
import { iconsLoaded, loadIcons } from "../icons/loader";
import { blockArrow } from "../paths/arrow";
import { measureHeadless } from "../text-measure";
import { resolveFontSize } from "../text-style";
import { keyStageOf, MIN_FONT_SIZE } from "../themes";
import { paintSurface, type SurfaceRole, surfaceStyle, surfacesOf } from "../themes/surfaces";
import { type Ctx, type FieldReport, type Figure, kit, type TemplateInput } from "./index";
import { type Age, ageProfileOf, resolveIcons, v2Colors, v2Profile } from "./items-row-deps";
import CAPACITY from "./myth-capacity.json" with { type: "json" };

/** The proof under the fact: one line, plus 1-2 library icons or one picture. */
export type MythProof = {
  line: string;
  icons?: string[] | null;
  /** One picture; `photo: ""` is an open slot (still being found). */
  picture?: Figure | null;
};

export type MythInput = {
  opening?: "vote" | "straight";
  verdict?: "myth" | "true";
  claim: string;
  fact: string;
  /** An exact span of the fact shown in the accent (at most one). */
  factEm?: string | null;
  proof?: MythProof | null;
};

export const MYTH_NAMES = {
  card: "Claim card",
  claimOpen: "Claim open",
  ask: "True or false",
  chip: "Choice chip",
  chipGlyph: "Choice glyph",
  chipLabel: "Choice label",
  cover: "Verdict ground",
  panel: "Claim panel",
  stampDisc: "Verdict disc",
  stampGlyph: "Verdict glyph",
  stamp: "Verdict",
  claim: "Claim",
  factPanel: "Fact panel",
  halo: "Seam halo",
  seam: "Seam disc",
  seamArrow: "Seam arrow",
  factLabel: "Fact label",
  fact: "Fact",
  icon: "Proof icon",
  iconTile: "Proof icon tile",
  picture: "Proof picture",
  line: "Proof line",
} as const;

/** The verdict's words: the stamp and the fact panel's label. */
export const MYTH_WORDS = {
  myth: { stamp: "Myth", label: "Fact" },
  true: { stamp: "True", label: "Why it’s true" },
} as const;
export const MYTH_PROMPT = "True or false?";

/* Geometry: the pilot's px at 1440 x 2/3. */
const K = 2 / 3;
const W = 960;
const H = 540;
const BAND = 214 * K;
const SEAM = 560 * K;
const GAP = 8 * K;
const PAD_L = 96 * K;
const FP_L = 100 * K;
const FP_R = 72 * K;
const TOP = 84 * K;
const FOOT = 84 * K;
const CARD_IN = 72 * K;
const CARD_FOOT = 72 * K;
const TAG_H = 30 * K;
const TAG_GAP = 24 * K;
const STAMP_DISC_0 = 30 * K;
const SEAM_D = 84 * K;
const SEAM_TOP = 86 * K;
const ASK_GAP = 48 * K;
const CHIP_H = 76 * K;
const CHIP_PAD = 32 * K;
const CHIP_LINE = 3 * K;
const CHIP_GLYPH = 30 * K;
const PROOF_TOP = 40 * K;
const PROOF_GAP = 32 * K;
const ICON_GAP = 16 * K;
const PIC = { w: 300 * K, h: 200 * K };
const MAX_TEXT = 600 * K;
/** The fact's measure (round 4 `themes4.css`: `.myth .fact { max-width: 660px }`). */
const FACT_MAX = 660 * K;
/**
 * The gold's grow-the-fact fit (round 5 `render5.mjs` `growMyth`): the fact grows in 2px steps up
 * to 64px while the fact panel still holds it, the proof's line stays 48px under the fact and the
 * claim (which follows the fact's size) still fits its panel.
 */
const GROW_TOP = 64 * K;
const CLAIM_DROP = 76 * K;
const GROW_STEP = 2 * K;
const PROOF_CLEAR = 48 * K;
/** The panel claim's line height follows round 4 (`.myth .said` at the fact's size, 1.16). */
const LH = { claimOpen: 1.18, claim: 1.16, fact: 1.12 };

/* ------------------------------------------------------------------ */
/* Caps (myth-capacity.json, measured by myth-capacity.ts)              */
/* ------------------------------------------------------------------ */

export type MythCap = { cap: number; hardMax: number };
export type MythField = "title" | "claim" | "fact" | "factPicture" | "proof";
type Table = Record<Age, Record<MythField, MythCap>>;
let TABLE = CAPACITY as unknown as Partial<Table>;
/** Measuring geometry alone (the capacity script): no row is a fault while the table is built. */
let MEASURING = false;
/** Lays out with no caps table, so the capacity script measures geometry alone. */
export function withoutMythCaps<T>(f: () => T): T {
  const kept = TABLE;
  TABLE = {};
  MEASURING = true;
  try {
    return f();
  } finally {
    TABLE = kept;
    MEASURING = false;
  }
}
/** Lays out against another caps table (tests: an age or field with no row). */
export function withMythCaps<T>(table: Partial<Table>, f: () => T): T {
  const kept = TABLE;
  TABLE = table;
  try {
    return f();
  } finally {
    TABLE = kept;
  }
}
export const mythCapsOf = (age: Age) => TABLE[age];

export const words = (s: string | null | undefined) =>
  (s ?? "").replace(/\*\*/g, "").trim().split(/\s+/).filter(Boolean).length;

/* ------------------------------------------------------------------ */
/* Rich text                                                           */
/* ------------------------------------------------------------------ */

const docOf = (content: RichNode[]): RichDoc =>
  ({ type: "doc", content: [{ type: "paragraph", content }] }) as RichDoc;

/** The fact with its accent span (the first exact match) in the accent colour. */
function factDoc(fact: string, em: string | null | undefined, accent: string): RichDoc {
  const w = em?.trim();
  const at = w ? fact.indexOf(w) : -1;
  if (!w || at < 0) return kit.doc(fact);
  return docOf(
    [
      styledRun(fact.slice(0, at), {}),
      styledRun(w, { color: accent }),
      styledRun(fact.slice(at + w.length), {}),
    ].filter((n) => n.text),
  );
}

/**
 * The proof line: muted, each `**…**` span the payoff in ink bold. The box is ink and the muted
 * runs carry the colour, so the bold run is plain bold (bold in a colour reads as a key-term chip).
 */
function lineDoc(line: string, muted: string): RichDoc {
  const parts = line.split(/\*\*(.+?)\*\*/g);
  const runs: RichNode[] = parts
    .map((text, i) =>
      i % 2
        ? ({
            type: "text",
            text,
            marks: [{ type: "bold" }],
          } as RichNode)
        : styledRun(text, { color: muted }),
    )
    .filter((n) => n.text);
  return docOf(runs.length ? runs : [styledRun(line, { color: muted })]);
}

/**
 * The claim, upright in the body face (round 4 'myth strike': the italic quote face read as odd);
 * the panel's myth claim carries the strike from `strike`.
 */
const claimDoc = (claim: string, strike?: number): RichDoc =>
  docOf([styledRun(claim, strike === undefined ? {} : { strikeStep: strike })]);

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

const round1 = (v: number) => Math.round(v * 10) / 10;
type Photo = Extract<Figure, { photo: string }>;
const hasPicture = (p: Figure | null | undefined): p is Photo =>
  !!p && typeof p === "object" && "photo" in p && typeof p.photo === "string";

export function layoutMyth(c: Ctx, input: TemplateInput) {
  const m: MythInput = input.myth ?? { claim: "", fact: "" };
  const age = ageProfileOf(keyStageOf(c.t) ?? "ks2");
  const v2 = v2Profile(c.t);
  const col = v2Colors(c.t);
  const vote = m.opening !== "straight";
  const verdict = vote && m.verdict === "true" ? "true" : "myth";
  const say = MYTH_WORDS[verdict];
  // Steps: the vote's card at 0, the verdict at 1, the fact at 2; straight starts at the verdict.
  const at = { verdict: vote ? 1 : 0, fact: vote ? 2 : 1 };
  const measure = measureHeadless(c.t);
  const drawn = (p: TextPreset, size: number) => resolveFontSize(c.t, p, round1(size));
  const floorBody = Math.max(MIN_FONT_SIZE.body, v2.floors.body);
  const floorName = Math.max(MIN_FONT_SIZE.body, v2.floors.name);
  // Labels at the smallest step at or over the reading floor (the gold's 22px label is under it).
  const small = drawn("small", MIN_FONT_SIZE.body);
  const label = small >= MIN_FONT_SIZE.body ? small : drawn("body", MIN_FONT_SIZE.body);
  // The gold's body px sits on the scale's small step (as steps-model, part af): the proof line
  // and the chips are support under the hero fact.
  const smallBody = drawn("small", Math.max(MIN_FONT_SIZE.body, v2.sizes.body));
  const body = smallBody >= MIN_FONT_SIZE.body ? smallBody : drawn("body", MIN_FONT_SIZE.body);
  const bodyPreset: TextPreset = smallBody >= MIN_FONT_SIZE.body ? "small" : "body";
  const lh = v2.lineHeights.body;
  const heightOf = (
    doc: RichDoc,
    preset: TextPreset,
    size: number,
    w: number,
    weight: number,
    lineHeight?: number,
    fontFamily?: string,
  ) =>
    measure({
      doc,
      preset,
      fontSize: size,
      width: w,
      inset: 0,
      chrome: 0,
      style: {
        preset,
        fontWeight: weight,
        lineHeight: lineHeight ?? (preset === "heading" ? LH.fact : lh),
        padding: 0,
        ...(fontFamily ? { fontFamily } : {}),
      },
    } as never);
  const claimText = m.claim.trim();
  const factText = m.fact.trim();

  // Title.
  let band = BAND;
  const head = input.heading.trim();
  if (head) {
    const el = kit.heading(c, head);
    band = Math.max(BAND, Math.ceil(el.y + el.h + 24 * K));
    c.bodyFromHeading = true;
  }
  const stageH = H - band;

  // Proof: icons that resolve (misses dropped), else a picture, else the line alone.
  const proof = m.proof && (m.proof.line ?? "").trim() ? m.proof : null;
  const labels = (proof?.icons ?? []).filter((l) => typeof l === "string" && l.trim()).slice(0, 2);
  const res = resolveIcons(labels);
  if (res.misses.length) c.iconMisses = res.misses;
  const iconIds = res.ids.filter((id): id is string => !!id);
  const pic = proof && hasPicture(proof.picture) ? proof.picture : null;
  // Icons give way before the fact goes over: full medals, smaller medals, then the line alone.
  const full = Math.round(v2.disc);
  const rungs = iconIds.length && !pic ? [full, Math.round(full * 0.75), 0] : [full];

  // The fact panel's room and the fact's fit (steps down to the name floor).
  const fp = { x: SEAM + GAP, y: band, w: W - SEAM - GAP, h: stageH };
  const inner = { x: fp.x + FP_L, y: fp.y + TOP, w: fp.w - FP_L - FP_R, h: fp.h - TOP - FOOT };
  const factW = Math.min(FACT_MAX, inner.w);
  const lineDocV = proof ? lineDoc(proof.line.trim(), col.muted) : null;
  // The fact's emphasis: the theme's emphasis token (Geometric's `--fa-accent`), else the accent.
  const factDocV = factDoc(factText, m.factEm, surfacesOf(c.t).marks.emphasis ?? col.accent);
  const factWt = v2.displayWeight;

  // The claim (round 4 'myth strike', every theme): the body face, upright, 600 (or the theme's own
  // weight), in the panel at the fact's size.
  // Round 4 sets the panel claim lower once the verdict is shown (`.cw` top: band + top + 76px).
  const claimTop = band + TOP + CLAIM_DROP;
  const claimW = SEAM - PAD_L - 64 * K;
  const claimRoom = H - FOOT - claimTop;
  const claimWt = surfacesOf(c.t).marks.claimWeight ?? 600;
  const bodyFace = c.t.fonts.body;
  const claimH = (s: number, w = claimW, l = LH.claim) =>
    heightOf(claimDoc(claimText), "heading", s, w, claimWt, l, bodyFace);
  const claimFits = (s: number) => claimH(s) <= claimRoom + 0.5;

  const fitFact = (disc: number) => {
    const shown = disc ? iconIds : [];
    const visW = pic
      ? PIC.w
      : shown.length
        ? shown.length * disc + (shown.length - 1) * ICON_GAP
        : 0;
    const visH = pic ? PIC.h : shown.length ? disc : 0;
    const lineW = Math.min(MAX_TEXT, inner.w - (visW ? visW + PROOF_GAP : 0));
    const lineH = lineDocV ? heightOf(lineDocV, bodyPreset, body, lineW, c.t.weights.body) : 0;
    const proofH = proof ? PROOF_TOP + Math.max(visH, lineH) : 0;
    const room = inner.h - TAG_H - TAG_GAP - proofH;
    let size = drawn("heading", v2.sizes.name);
    let h = heightOf(factDocV, "heading", size, factW, factWt);
    while (h > room + 0.5 && size > drawn("heading", floorName)) {
      size = drawn("heading", size - 1);
      h = heightOf(factDocV, "heading", size, factW, factWt);
    }
    const over = h > room + 0.5;
    // Grow to fill (gold `growMyth`, round5/render5.mjs line 68: `while (f < 64)`, no age branch):
    // the next even gold px up, 2px at a time, to 64px. The box is drawn at its ceiled height, so
    // the clearance is checked on that box.
    let grown = false;
    if (!over && factText) {
      const proofTop = inner.y + inner.h - Math.max(visH, lineH);
      const factTop = inner.y + TAG_H + TAG_GAP;
      let next = (Math.floor(size / K / 2 + 1e-6) + 1) * 2 * K;
      while (next <= GROW_TOP + 1e-6) {
        const nh = heightOf(factDocV, "heading", next, factW, factWt);
        const clear = !proof || proofTop - (factTop + Math.ceil(nh)) >= PROOF_CLEAR + 0.1;
        if (nh > room + 0.5 || !clear || !claimFits(next)) break;
        size = round1(next);
        h = nh;
        grown = true;
        next += GROW_STEP;
      }
    }
    return { disc, shown, visH, lineW, lineH, size, h, over, grown };
  };
  let ff = fitFact(rungs[0] as number);
  for (const d of rungs.slice(1)) {
    if (!ff.over) break;
    ff = fitFact(d);
  }
  const { disc, visH, lineW, lineH, over: factOver } = ff;
  const shownIcons = ff.shown;

  // The claim is always the fact's size (round 4: `.said { font-size: var(--fact-size) }`). A claim
  // too long for its panel at that size takes both down in the gold's 2px together, never under the
  // smallest step the stage allows the claim (its body step, held at the body floor); the fact only
  // gets more room. Both are drawn as given (`fixedSize`) once off the stage's steps.
  const claimFloor = drawn("heading", floorBody);
  let shared = ff.size;
  while (!claimFits(shared) && shared > claimFloor + 1e-6)
    shared = round1(Math.max(claimFloor, shared - GROW_STEP));
  const shrunk = shared < ff.size - 1e-6;
  const factSize = shared;
  const claimSize = shared;
  const factH = shrunk ? heightOf(factDocV, "heading", factSize, factW, factWt) : ff.h;
  const grown = ff.grown || shrunk;
  const claimOver = !claimFits(claimSize);

  // The open claim on the vote card: at most 3 lines, no smaller than the name size.
  const card = { x: PAD_L, y: band, w: W - 2 * PAD_L, h: stageH - CARD_FOOT };
  const openW = card.w - 2 * CARD_IN;
  let openSize = drawn("heading", v2.sizes.title);
  const openLines = (s: number) => Math.round(claimH(s, openW, LH.claimOpen) / (s * LH.claimOpen));
  while (vote && openLines(openSize) > 3 && openSize > drawn("heading", v2.sizes.name))
    openSize = drawn("heading", openSize - 4 / 3);
  const openOver = vote && openLines(openSize) > 3;

  // Field report and overs.
  const fields = report(age, input.heading.trim(), m, !!pic);
  c.fields = fields;
  for (const f of fields) if (f.over) c.over.push(f.field);
  if (!claimText) c.over.push("myth.claim");
  if (!factText) c.over.push("myth.fact");
  if ((claimOver || openOver) && !c.over.includes("myth.claim")) c.over.push("myth.claim");
  if (factOver && !c.over.includes("myth.fact") && !c.over.includes("myth.proof.line"))
    c.over.push(proof ? "myth.proof.line" : "myth.fact");
  c.tight =
    fields.some((f) => f.tight) || factSize < drawn("heading", v2.sizes.name) - 0.5 || shrunk;

  const radius = Math.round(v2.radius.picture);
  const push = <T extends SlideElement>(el: T, step: number, name: string): T => {
    Object.assign(el, { name, ...(step > 0 ? { revealStep: step, reveal: "fade" } : {}) });
    c.els.push(el);
    return el;
  };
  const surface = (role: SurfaceRole, box: Box, step: number, name: string, own?: number) => {
    const el = paintSurface(
      {
        role,
        box: rnd(box),
        id: uid(),
        ...(own === undefined
          ? {}
          : { own: [own, own, own, own] as [number, number, number, number] }),
      },
      c.t,
    );
    if (el) push({ ...el, locked: false } as SlideElement, step, name);
    return el;
  };

  // Step 0 (vote): the claim alone on a sand card, "True or false?" and two neutral chips.
  if (vote) {
    surface("field-b", card, 0, MYTH_NAMES.card, radius);
    const oh = claimH(openSize, openW, LH.claimOpen);
    const block = oh + ASK_GAP + CHIP_H;
    const oy = band + Math.max(0, (card.h - block) / 2);
    push(
      textEl(
        claimDoc(claimText),
        "heading",
        openSize,
        LH.claimOpen,
        claimWt,
        { x: card.x + CARD_IN, y: oy, w: openW, h: oh },
        col.ink,
        bodyFace,
      ),
      0,
      MYTH_NAMES.claimOpen,
    );
    const ay = oy + oh + ASK_GAP;
    const bold = 700;
    const ask = kit.doc(MYTH_PROMPT);
    const askW = Math.ceil(textWidth(c, MYTH_PROMPT, body, bold)) + 2;
    push(
      textEl(
        ask,
        "body",
        body,
        1,
        bold,
        { x: card.x + CARD_IN, y: ay + (CHIP_H - body) / 2, w: askW, h: body },
        col.ink,
      ),
      0,
      MYTH_NAMES.ask,
    );
    let x = card.x + CARD_IN + askW + 16 * K + 24 * K;
    for (const k of ["true", "myth"] as const) {
      const word = k === "true" ? "True" : "False";
      const tw = Math.ceil(textWidth(c, word, body, bold)) + 2;
      const cw = CHIP_PAD * 2 + CHIP_GLYPH + 14 * K + tw;
      const chip: ShapeElement = {
        id: uid(),
        type: "shape",
        shape: "rounded",
        ...rnd({ x, y: ay, w: cw, h: CHIP_H }),
        radius,
        fill: col.surface,
        stroke: col.ink,
        strokeWidth: round1(CHIP_LINE),
      };
      push(chip, 0, MYTH_NAMES.chip);
      push(
        glyph(
          k,
          { x: x + CHIP_PAD, y: ay + (CHIP_H - CHIP_GLYPH) / 2, s: CHIP_GLYPH },
          col.ink,
          3.2,
        ),
        0,
        MYTH_NAMES.chipGlyph,
      );
      push(
        textEl(
          kit.doc(word),
          "body",
          body,
          1,
          bold,
          { x: x + CHIP_PAD + CHIP_GLYPH + 14 * K, y: ay + (CHIP_H - body) / 2, w: tw, h: body },
          col.ink,
        ),
        0,
        MYTH_NAMES.chipLabel,
      );
      x += cw + 24 * K;
    }
    // The verdict's ground over the card's right half (the claim panel covers its left). A torn
    // claim panel (Scrapbook's `field-edge: torn`) bites into its own box, so the ground then runs
    // under it too and the claim card never shows through the tear.
    const torn = surfacesOf(c.t).marks.field === "torn";
    const ground: ShapeElement = {
      id: uid(),
      type: "shape",
      shape: "rect",
      ...rnd(
        torn ? { x: 0, y: band, w: W, h: stageH } : { x: SEAM, y: band, w: W - SEAM, h: stageH },
      ),
      fill: col.background,
    };
    push(ground, at.verdict, MYTH_NAMES.cover);
  }

  // The verdict: the claim panel, the stamp, the claim (struck when a myth).
  surface("field-b", { x: 0, y: band, w: SEAM, h: stageH }, at.verdict, MYTH_NAMES.panel, 0);
  const sy = band + TOP;
  const right = verdict === "true";
  // A theme's own verdict disc (Geometric: 42px = 28pt, round 5 myth); the other golds' 30px.
  const ownDisc = surfacesOf(c.t).marks.verdictDisc;
  const STAMP_DISC = ownDisc > 0 ? ownDisc * K : STAMP_DISC_0;
  const stampFill =
    paintSurface(
      { role: right ? "verdict-right" : "verdict-wrong", box: { x: 0, y: 0, w: 1, h: 1 }, id: "x" },
      c.t,
    )?.fill ?? col.accent;
  const sd: ShapeElement = {
    id: uid(),
    type: "shape",
    shape: "ellipse",
    ...rnd({ x: PAD_L, y: sy + (TAG_H - STAMP_DISC) / 2, w: STAMP_DISC, h: STAMP_DISC }),
    fill: stampFill,
  };
  push(sd, at.verdict, MYTH_NAMES.stampDisc);
  push(
    glyph(
      right ? "true" : "myth",
      {
        x: PAD_L + STAMP_DISC * 0.2,
        y: sy + (TAG_H - STAMP_DISC) / 2 + STAMP_DISC * 0.2,
        s: STAMP_DISC * 0.6,
      },
      col.onDeep,
      3.2,
    ),
    at.verdict,
    MYTH_NAMES.stampGlyph,
  );
  push(
    tagEl(say.stamp, label, { x: PAD_L + STAMP_DISC + 12 * K, y: sy, w: claimW }, col.ink, c),
    at.verdict,
    MYTH_NAMES.stamp,
  );
  push(
    textEl(
      claimDoc(claimText, right ? undefined : at.verdict),
      "heading",
      claimSize,
      LH.claim,
      claimWt,
      { x: PAD_L, y: claimTop, w: claimW, h: claimH(claimSize) },
      right ? col.ink : col.muted,
      bodyFace,
      true,
    ),
    at.verdict,
    MYTH_NAMES.claim,
  );

  // The fact: its panel, the seam arrow, the label, the fact, the proof.
  surface("field-a", fp, at.fact, MYTH_NAMES.factPanel, 0);
  const cx = SEAM + GAP / 2;
  const cy = band + SEAM_TOP + SEAM_D / 2;
  // The seam takes the theme's badge family (Geometric's hexagon, THEMING.md section 6).
  // The seam is the theme's marker (roles.css `--marker-fill`, the seam disc; its arrow `--marker-ink`).
  const markerRole = surfacesOf(c.t).roles.marker;
  const markerFill = markerRole?.fill ?? col.deep;
  // Its ink, else (none, or under 4.5:1 on the fill) whichever of on-deep and ink reads best.
  const markerInk =
    markerRole?.ink && contrastRatio(markerRole.ink, markerFill) >= 4.5
      ? markerRole.ink
      : [col.onDeep, col.ink].reduce((a, b) =>
          contrastRatio(b, markerFill) > contrastRatio(a, markerFill) ? b : a,
        );
  const marker = { fill: markerFill, ink: markerInk };
  // Poster's block-offset family squares its seam (round 2 roles-map: the chip in the connector's box).
  const seamShape: ShapeElement["shape"] =
    surfacesOf(c.t).marks.badge === "hex"
      ? "hexagon"
      : surfacesOf(c.t).marks.connector === "block-offset"
        ? "rect"
        : "ellipse";
  const halo: ShapeElement = {
    id: uid(),
    type: "shape",
    shape: seamShape,
    ...rnd({
      x: cx - SEAM_D / 2 - GAP,
      y: cy - SEAM_D / 2 - GAP,
      w: SEAM_D + 2 * GAP,
      h: SEAM_D + 2 * GAP,
    }),
    fill: col.background,
  };
  // A theme without a seam halo (Geometric, round 5 myth) sits its seam straight on the panels.
  if (surfacesOf(c.t).marks.seamHalo) push(halo, at.fact, MYTH_NAMES.halo);
  const seam: ShapeElement = {
    id: uid(),
    type: "shape",
    shape: seamShape,
    ...rnd({ x: cx - SEAM_D / 2, y: cy - SEAM_D / 2, w: SEAM_D, h: SEAM_D }),
    fill: marker.fill,
  };
  push(seam, at.fact, MYTH_NAMES.seam);
  const aw = SEAM_D * 0.44;
  if (seamShape === "hexagon" || seamShape === "rect") {
    // The gold's open line arrow: a shaft and a chevron head, 4.5px (3pt) round strokes, 20x16px
    // (Geometric's hexagon; Poster's square seam draws the same 24x20px arrow, review item 43).
    const w = 20 * K;
    const h = 16 * K;
    push(
      {
        id: uid(),
        type: "path",
        ...rnd({ x: cx - w / 2, y: cy - h / 2, w, h }),
        points: [
          { x: 0, y: 0.5 },
          { x: 1, y: 0.5 },
          { x: 0.55, y: 0 },
          { x: 1, y: 0.5 },
          { x: 0.55, y: 1 },
        ],
        closed: false,
        stroke: marker.ink,
        strokeWidth: 3,
      } as PathElement,
      at.fact,
      MYTH_NAMES.seamArrow,
    );
  } else {
    const pts = blockArrow([cx - aw / 2, cy], [cx + aw / 2, cy], {
      shaft: aw * 0.22,
      head: aw * 0.7,
      headLen: aw * 0.45,
    });
    push(closedPath(pts, marker.ink), at.fact, MYTH_NAMES.seamArrow);
  }
  // The label in accent-deep for AA on the field tint; on a dark theme the deep is the dark end, so
  // the accent itself reads there.
  push(
    tagEl(
      say.label,
      label,
      { x: inner.x, y: inner.y, w: inner.w },
      c.t.dark ? col.accent : col.deep,
      c,
    ),
    at.fact,
    MYTH_NAMES.factLabel,
  );
  push(
    textEl(
      factDocV,
      "heading",
      factSize,
      LH.fact,
      factWt,
      { x: inner.x, y: inner.y + TAG_H + TAG_GAP, w: factW, h: factH },
      col.ink,
      undefined,
      grown,
    ),
    at.fact,
    MYTH_NAMES.fact,
  );
  if (proof && lineDocV) {
    const rowH = Math.max(visH, lineH);
    const ry = inner.y + inner.h - rowH;
    let x = inner.x;
    if (pic) {
      kit.photoBox(
        c,
        {
          photo: pic.photo,
          alt: pic.alt ?? proof.line,
          ...(pic.request ? { request: pic.request } : {}),
        },
        rnd({ x, y: ry + (rowH - PIC.h) / 2, ...PIC }),
      );
      const img = c.els.at(-1) as SlideElement | undefined;
      if (img)
        Object.assign(img, {
          name: MYTH_NAMES.picture,
          radius,
          revealStep: at.fact,
          reveal: "fade",
        });
      x += PIC.w + PROOF_GAP;
    } else if (shownIcons.length) {
      const tile = surfacesOf(c.t).marks.medal === "tile";
      for (const id of shownIcons) {
        const box = rnd({ x, y: ry + (rowH - disc) / 2, w: disc, h: disc });
        if (tile) {
          // Poster's tile medal (round 2 `--medal-shape: tile`, roles2.css `border-radius: 22%`, a
          // 3px ink line and `--medal-shade: 6px 6px 0`): the icon sits on a white outlined tile.
          const m = surfaceStyle(c.t, "medal");
          push(
            {
              id: uid(),
              type: "shape",
              shape: "rounded",
              ...box,
              radius: Math.round(disc * 0.22),
              fill: m.fill,
              ...(m.line ? { stroke: m.line, strokeWidth: m.lineWidth ?? 2 } : {}),
              ...(m.shadow ? { shadow: m.shadow } : {}),
            } as ShapeElement,
            at.fact,
            MYTH_NAMES.iconTile,
          );
        }
        push(medalImage(c, id, box, col, tile), at.fact, MYTH_NAMES.icon);
        x += disc + ICON_GAP;
      }
      x += PROOF_GAP - ICON_GAP;
    }
    push(
      textEl(
        lineDocV,
        bodyPreset,
        body,
        lh,
        c.t.weights.body,
        { x, y: ry + (rowH - lineH) / 2, w: lineW, h: lineH },
        col.ink,
      ),
      at.fact,
      MYTH_NAMES.line,
    );
  }
}

/** Which input path each laid element shows, for the editor's LayoutRef binding. */
export function mythPaths(els: readonly { name?: string }[]): (string | undefined)[] {
  return els.map((el) => {
    if (el.name === "Heading") return "heading";
    if (el.name === MYTH_NAMES.claim || el.name === MYTH_NAMES.claimOpen) return "myth.claim";
    if (el.name === MYTH_NAMES.fact) return "myth.fact";
    if (el.name === MYTH_NAMES.line) return "myth.proof.line";
    return undefined;
  });
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

type Box = { x: number; y: number; w: number; h: number };
const rnd = (b: Box): Box => ({ x: round1(b.x), y: round1(b.y), w: round1(b.w), h: round1(b.h) });

function textEl(
  doc: RichDoc,
  preset: TextPreset,
  size: number,
  lineHeight: number,
  weight: number,
  b: Box,
  color: string,
  fontFamily?: string,
  fixedSize?: boolean,
): TextElement {
  return {
    id: uid(),
    type: "text",
    ...rnd({ ...b, h: Math.ceil(b.h) }),
    doc,
    style: {
      preset,
      autoHeight: true,
      fontSize: size,
      ...(fixedSize ? { fixedSize: true } : {}),
      ...(fontFamily ? { fontFamily } : {}),
      lineHeight,
      fontWeight: weight,
      padding: 0,
      color,
    },
  };
}

/** A label (the stamp, the fact panel's label): bold, spaced capitals, one line. */
function tagEl(
  word: string,
  size: number,
  b: { x: number; y: number; w: number },
  color: string,
  c: Ctx,
) {
  const el = textEl(
    kit.doc(word.toUpperCase()),
    "body",
    size,
    1,
    700,
    { ...b, y: b.y + (TAG_H - size) / 2, h: size },
    color,
  );
  // A theme's tag tracking (Geometric 0.08em) adds its em per letter to the measured width.
  const track = surfacesOf(c.t).marks.tagTracking;
  const extra = track ? Number.parseFloat(track) * size * word.length : 0;
  el.w = Math.min(b.w, Math.ceil(textWidth(c, word.toUpperCase(), size, 700) * 1.12 + extra) + 4);
  if (track) el.style = { ...el.style, letterSpacing: track };
  return el;
}

const textWidth = (c: Ctx, s: string, size: number, weight: number) => {
  // One line's width: the widest box that still measures one line, found by halving.
  const m = measureHeadless(c.t);
  const h1 = (w: number) =>
    m({
      doc: kit.doc(s),
      preset: "body",
      fontSize: size,
      width: w,
      inset: 0,
      chrome: 0,
      style: { preset: "body", fontWeight: weight, lineHeight: 1, padding: 0 },
    } as never) <=
    size + 0.5;
  let lo = 0;
  let hi = W;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (h1(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
};

/** The ✓ (true) or ✕ (myth) glyph, an open stroked path in a 24-unit box scaled to `s`. */
function glyph(
  k: "true" | "myth",
  b: { x: number; y: number; s: number },
  colour: string,
  sw: number,
): PathElement {
  const raw =
    k === "true"
      ? [
          [5.5, 12.5],
          [10, 17],
          [18.5, 7.5],
        ]
      : [
          [7, 7],
          [17, 17],
          [12, 12],
          [17, 7],
          [7, 17],
        ];
  return {
    id: uid(),
    type: "path",
    ...rnd({ x: b.x, y: b.y, w: b.s, h: b.s }),
    points: raw.map(([x, y]) => ({
      x: +((x as number) / 24).toFixed(4),
      y: +((y as number) / 24).toFixed(4),
    })),
    closed: false,
    stroke: colour,
    strokeWidth: round1((sw * b.s) / 24),
  };
}

function closedPath(pts: readonly (readonly [number, number])[], colour: string): PathElement {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0;
  const h = Math.max(...ys) - y0;
  return {
    id: uid(),
    type: "path",
    ...rnd({ x: x0, y: y0, w, h }),
    points: pts.map(([x, y]) => ({ x: +((x - x0) / w).toFixed(4), y: +((y - y0) / h).toFixed(4) })),
    closed: true,
    fill: colour,
    stroke: colour,
    strokeWidth: 0,
  };
}

/** A library icon in the shared medal (a deep face on dark themes, ruling 247). */
function medalImage(
  c: Ctx,
  id: string,
  b: Box,
  col: ReturnType<typeof v2Colors>,
  onTile = false,
): ImageElement {
  const lib = iconsLoaded();
  if (!lib) void loadIcons();
  const own = lib?.medalColoursFor({
    dark: c.t.dark,
    colors: { background: col.background, surface: col.surface, accent: col.accent },
    fields: col.fields,
  });
  // On a tile the tile is the medal: the disc takes the tile's face and no ring of its own.
  const medal = own && onTile ? { ...own, fill: surfaceStyle(c.t, "medal").fill, line: null } : own;
  const src =
    lib && medal
      ? lib.iconMedalImageSrc(id, {
          medal,
          ...(surfacesOf(c.t).marks.medal === "hex" ? { shape: "hex" as const } : {}),
          // A theme whose gold outlines its proof icons in ink (Geometric) draws the outlined style.
          ...(surfacesOf(c.t).marks.iconOutline ? { style: "pilot" as const } : {}),
          // As every layout's icons (iconSvgForTheme): the theme's slots, the age's drawing and
          // the size's line weights, so the feather keeps its outline at medal size.
          colours: lib.iconColoursFor({
            colors: c.t.colors,
            iconSlots: col.icon,
            keyStage: keyStageOf(c.t) ?? undefined,
          }),
          age: lib.iconAgeFor(keyStageOf(c.t) ?? undefined),
          size: lib.iconSizeFor(b.w * 0.8),
          px: Math.round(b.w * 2),
        })
      : "";
  return {
    id: uid(),
    type: "image",
    ...b,
    src,
    alt: id,
    fit: "contain",
    ...(surfacesOf(c.t).marks.medal === "hex" ? {} : { radius: Math.round(b.w / 2) }),
  };
}

function report(age: Age, heading: string, m: MythInput, picture: boolean): FieldReport[] {
  const caps = mythCapsOf(age);
  const row = (field: string, value: string, cap?: MythCap): FieldReport => {
    const n = words(value);
    // A cap of 0 holds nothing, and a missing row is an unknown combination: both are over,
    // never "no cap" (only the capacity script, measuring geometry, lays out without a table).
    const over = MEASURING ? false : !cap || n > cap.hardMax;
    return {
      field,
      path: field,
      chars: n,
      cap: cap?.cap ?? 0,
      hardMax: cap?.hardMax ?? 0,
      tight: MEASURING ? false : !cap || n > cap.cap,
      over,
    };
  };
  const out = [
    row("heading", heading, caps?.title),
    row("myth.claim", m.claim, caps?.claim),
    row("myth.fact", m.fact, picture ? caps?.factPicture : caps?.fact),
  ];
  if (m.proof?.line?.trim()) out.push(row("myth.proof.line", m.proof.line, caps?.proof));
  return out;
}
