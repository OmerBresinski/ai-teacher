// Named pictures (libfix round 1). Every model's built-in art is a closed set: a few hand-drawn kinds.
// A name the teacher gives (an organism, an object, a person) is drawn with a kind's art only when the
// name really is that kind ("Grey seal" on the seal art). Anything else draws a clean labelled card in
// the library's style, never the nearest wrong picture (a shark is never drawn as a seal).
//
// The card is the hook for a shared picture library: registerPictureSource(fn) adds a source that,
// given a name, returns {href} for a real cut-out; the card then shows that picture above its label.
// Until a source answers, the card shows the name alone.
//
// Every picture drawn is logged (name, what it was drawn as), so the engine can build alt text from
// what is actually on the slide and the corpus test can check that no name sits on someone else's art.
import { h, measure, T, wrap } from "./svg.js";

/* ------------------------------------------------------------------ names */
const IRREGULAR = {
  lice: "louse",
  mice: "mouse",
  geese: "goose",
  children: "child",
  people: "person",
  men: "man",
  women: "woman",
  teeth: "tooth",
  feet: "foot",
  oxen: "ox",
  leaves: "leaf",
  knives: "knife",
  wolves: "wolf",
  calves: "calf",
  loaves: "loaf",
  halves: "half",
  shelves: "shelf",
  cacti: "cactus",
  fungi: "fungus",
  larvae: "larva",
  pupae: "pupa",
};
const KEEP_S = /(ss|us|is|ous|ics|news|species|series|glasses|scissors|chess)$/;
export function singular(w) {
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length <= 3 || KEEP_S.test(w)) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(ches|shes|xes|zes|sses|oes)$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}
/** Lower case, no accents or punctuation, each word singular: "Blue-tits!" -> "blue tit". */
export const normName = (s) =>
  String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(singular)
    .join(" ");
/** True when the name is one of the aliases, or contains one as whole words ("Common frog" fits "frog").
 *  An empty name fits (the model uses its stock name). */
export function nameFits(name, aliases) {
  const n = normName(name);
  if (!n) return true;
  const padded = ` ${n} `;
  return (aliases || []).some((a) => {
    const x = normName(a);
    return x && (n === x || padded.includes(` ${x} `));
  });
}
/** The art kind to draw for a name: the preferred kind when the name fits its aliases, else any kind in
 *  the set the name fits (only when `any` is set), else null (draw a card). */
export function pickArt(name, art, preferred, { any = false } = {}) {
  if (preferred && art[preferred] && nameFits(name, art[preferred])) return preferred;
  if (any)
    for (const [k, al] of Object.entries(art)) if (normName(name) && nameFits(name, al)) return k;
  return null;
}

/* ------------------------------------------------------------------ sources (the shared library hook) */
const SOURCES = [];
let LIBRARY = null;
/** kit/subjects.js installs the shared cut-out library here: fn(p, name, x, yBase, w, h, a) -> {g, id} | null. */
export function setPictureLibrary(fn) {
  LIBRARY = fn || null;
}
/** Add a picture source: fn(name, {model, hint}) -> {href, w?, h?} | null. Returns a remover. */
export function registerPictureSource(fn) {
  SOURCES.push(fn);
  return () => {
    const i = SOURCES.indexOf(fn);
    if (i >= 0) SOURCES.splice(i, 1);
  };
}
export function pictureFromSources(name, ctx = {}) {
  for (const f of SOURCES) {
    try {
      const r = f(name, ctx);
      if (r && r.href) return r;
    } catch (e) {
      /* a broken source never breaks a slide */
    }
  }
  return null;
}

/* ------------------------------------------------------------------ the draw log */
const LOG = [];
const CUTS = [];
export const resetDrawLog = () => {
  LOG.length = 0;
  CUTS.length = 0;
};
/** Wording cut short with "…" because it could not fit: logged so tests can measure clipping. */
export const noteCut = (s, where) => {
  CUTS.push({ text: String(s), where });
};
export const cutLog = () => CUTS.slice();
export const drawLog = () => LOG.slice();
/** Record that `name` was drawn as `as` (an art kind, or 'card'). Models call this when they draw art. */
export function noteArt(name, as) {
  if (name != null && String(name).trim()) LOG.push({ name: String(name).trim(), as });
}

/* ------------------------------------------------------------------ the card */
/**
 * A neutral labelled card for a named thing the model has no art for. Base centre at (x, y), so it
 * drops into any slot an art kind used: {w, h} is the slot. The label wraps to the card and shrinks a
 * step before it would ever be cut. With a picture source it shows the cut-out above a smaller label.
 * Returns the group, with .box = {x, y, w, h} like organism boxes.
 */
export function pictureCard(
  p,
  name,
  x,
  y,
  { w = 120, h: hh = 100, a = {}, edit, model, hint, label = true, noLibrary = false } = {},
) {
  // one picture path for every named thing: the shared subjects library (kit/subjects.js) first, then a
  // registered source (photo library or generation) shown on the card, then the labelled card alone
  if (LIBRARY && !noLibrary) {
    const r = LIBRARY(p, name, x, y, Math.max(56, w), Math.max(48, hh), a);
    if (r && r.g) {
      r.g.box = { x: x - Math.max(56, w) / 2, y: y - Math.max(48, hh), w: Math.max(56, w), h: Math.max(48, hh) };
      noteArt(name, `library:${r.id}`);
      return r.g;
    }
  }
  const g = h("g", Object.assign({}, a), p);
  g.dataset.picture = "card";
  g.dataset.name = String(name || "");
  const W0 = Math.max(56, w),
    H0 = Math.max(48, hh),
    x0 = x - W0 / 2,
    y0 = y - H0;
  h(
    "rect",
    {
      x: x0,
      y: y0,
      width: W0,
      height: H0,
      rx: "var(--r-mark)",
      fill: "var(--paper)",
      stroke: "var(--rule)",
      "stroke-width": "var(--sw-rule)",
      cls: "lift body",
    },
    g,
  );
  const src = pictureFromSources(name, { model, hint });
  let textTop = y0,
    textH = H0;
  if (src) {
    const ih = H0 * (label ? 0.66 : 0.9);
    h(
      "image",
      {
        href: src.href,
        x: x0 + 6,
        y: y0 + 6,
        width: W0 - 12,
        height: ih - 6,
        preserveAspectRatio: "xMidYMid meet",
      },
      g,
    );
    textTop = y0 + ih;
    textH = H0 - ih;
  }
  if (label && String(name || "").trim()) {
    const pad = 8,
      maxW = W0 - pad * 2;
    // the biggest type step whose wrapped lines fit the card, words never broken mid-word if avoidable
    // the biggest type step that fits the card with every word whole; if a word is still too long at the
    // smallest step, the card widens to hold it rather than break it ("Lifeguar-d")
    const whole = String(name).trim().split(/\s+/).join(" ");
    let use = "ts-label",
      L = [],
      lh = 30,
      fitW = maxW;
    for (const [c, l] of [
      ["ts-label", 30],
      ["ts-small", 26],
      ["ts-tiny", 22],
    ]) {
      use = c;
      lh = l;
      L = wrap(g, name, c, maxW);
      if (L.length * l <= textH - pad && L.join(" ") === whole) break;
    }
    if (L.join(" ") !== whole) {
      fitW = Math.max(...whole.split(" ").map((wd) => measure(g, wd, use))) + 2;
      L = wrap(g, name, use, fitW);
    }
    if (fitW > maxW) {
      const grow = fitW - maxW;
      g.box = null;
      const r = g.querySelector("rect");
      r.setAttribute("x", x0 - grow / 2);
      r.setAttribute("width", W0 + grow);
    }
    const t0 = textTop + (textH - L.length * lh) / 2 + lh * 0.74;
    const t = h("text", { x, y: t0, "text-anchor": "middle", cls: use }, g);
    L.forEach((s, i) => h("tspan", { x, dy: i ? lh : 0, text: s }, t));
    if (edit) t.dataset.edit = edit;
  }
  const rr = g.querySelector("rect");
  g.box = { x: +rr.getAttribute("x"), y: y0, w: +rr.getAttribute("width"), h: H0 };
  noteArt(name, "card");
  return g;
}

/**
 * Draw a named thing: the art kind when the name fits it, else a card in the same slot.
 *   art       {kind: [aliases]} the model's closed set
 *   kind      the kind the params chose
 *   draw(kind) draws that kind and returns its group (with .box when it has one)
 *   slot      {w, h} the card's size when it falls back
 */
export function namedPicture(p, name, kind, art, draw, x, y, slot, opts = {}) {
  const use = pickArt(name, art, kind);
  if (use) {
    const g = draw(use);
    noteArt(name || use, use);
    return g;
  }
  return pictureCard(p, name, x, y, Object.assign({ w: slot.w, h: slot.h }, opts));
}
