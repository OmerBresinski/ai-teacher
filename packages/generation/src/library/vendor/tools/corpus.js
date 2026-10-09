// Flexibility corpus (libfix round 1). Fills every model with off-menu names, long labels, the fewest
// and the most list items each schema allows, and odd numbers, then measures the rendered slide.
// Loaded by tools/corpus.html, driven by tools/corpus.test.ts (bun test, headless Chromium).
//
// For each case: validate() may refuse (that is an honest answer); an accepted case must render
// without throwing, and its last build (the still) and first build are measured:
//   cut      a visible word cut short with "…" that the params did not end with
//   off      a text box outside the slide, or stage text below the foot rule
//   wrongArt a picture drawn as an art kind its name does not fit (from the kit's draw log)
//   altMiss  a named picture missing from the alt text the engine built
// Targeted cases (the audit's worst) also name the word the slide must not say, and whether the
// thing must be drawn as a card.
import { clone, fontsReady, GRID, H, mountSlide, W, withDefaults } from "../kit/index.js";
import registry from "../models/registry.js";

export const ids = () => registry.map((f) => f.replace(/\.js$/, ""));
export const ready = () => fontsReady();
const load = (id) => import(`../models/${id}.js`);

const OFF = [
  "Basking shark",
  "Hedgehog",
  "Lifeguard",
  "Sunflower",
  "Pirate",
  "Dragonfly",
  "Kangaroo",
  "Sledge",
];
const LONG =
  "Children counted these carefully during the long afternoon walk around the school field and pond";
const longText = (n) => {
  let s = LONG;
  while (s.length < n) s += " " + LONG;
  s = s.slice(0, n);
  return s.replace(/\s+\S*$/, "") || s.slice(0, n);
};
const NAMEISH = /^(name|object|plantName|label|who|what)$/;

// walk a value with its schema, applying f(schema, value, key) to leaves; arrays get resized by `count`
function mutate(schema, v, f, count, key = "") {
  if (!schema || v == null) return v;
  if (schema.type === "object" && typeof v === "object" && !Array.isArray(v)) {
    const out = Object.assign({}, v);
    for (const [k, s] of Object.entries(schema.properties || {}))
      if (k !== "text" && k !== "title" && out[k] !== undefined)
        out[k] = mutate(s, out[k], f, count, k);
    return out;
  }
  if (schema.type === "array" && Array.isArray(v)) {
    let arr = v.slice();
    const n = count ? count(schema, arr) : arr.length;
    const base = arr.length
      ? arr
      : schema.items && schema.items.default !== undefined
        ? [clone(schema.items.default)]
        : [];
    if (base.length) {
      const out = [];
      for (let i = 0; i < n; i++) out.push(clone(base[i % base.length]));
      arr = out;
    }
    return arr.map((x) => mutate(schema.items || {}, x, f, null, key));
  }
  return f(schema, v, key);
}
const sizeTo = (which) => (s, arr) =>
  which === "min"
    ? s.minItems != null
      ? s.minItems
      : arr.length
    : s.maxItems != null
      ? Math.min(s.maxItems, 12)
      : arr.length;
let offI = 0;
const variants = {
  offNames: (s, v, k) =>
    typeof v === "string" && !s.enum && NAMEISH.test(k)
      ? OFF[offI++ % OFF.length].slice(0, s.maxLength || 99)
      : v,
  longLabels: (s, v) =>
    typeof v === "string" &&
    !s.enum &&
    s.maxLength &&
    !s.pattern &&
    !/date|year|time/i.test(s.title || "")
      ? longText(s.maxLength)
      : v,
  oddNumbers: (s, v) =>
    typeof v === "number" && s.maximum != null
      ? s.maximum
      : typeof v === "number" && s.minimum != null
        ? s.minimum
        : v,
};

/** Measure one mounted build. */
function measureBuild(stage, P) {
  const cuts = stage.cuts; // the kit's cut log; an engine without one counts every rendered "…" the params did not hold
  const svg = stage.svg,
    sr = svg.getBoundingClientRect(),
    k = sr.width / W;
  const foot = svg.firstElementChild.children[2];
  const src = JSON.stringify(P);
  const out = { cut: [], off: [] };
  for (const t of svg.querySelectorAll("text")) {
    if (t.closest("defs,clipPath,mask,marker,pattern,symbol")) continue;
    let vis = true;
    for (let e = t; e && e !== svg; e = e.parentElement) {
      if (e.classList && e.classList.contains("off")) {
        vis = false;
        break;
      }
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) {
        vis = false;
        break;
      }
    }
    const s = (t.textContent || "").trim();
    if (!vis || !s) continue;
    const r = t.getBoundingClientRect();
    if (r.width < 1) continue;
    const b = {
      x: (r.left - sr.left) / k,
      y: (r.top - sr.top) / k,
      w: r.width / k,
      h: r.height / k,
    };
    const parts = t.querySelectorAll("tspan").length
      ? [...t.querySelectorAll("tspan")].map((x) => x.textContent)
      : [s];
    // a cut is a rendered line ending in "…" that the kit logged as cut (a pattern caption that ends "…" on
    // purpose is not one)
    for (const line of parts) {
      const L = line.trim();
      if (!/…$/.test(L) || src.includes(L)) continue;
      const head = L.slice(0, -1).trim().split(/\s+/).pop() || "";
      if (!cuts || cuts.some((c) => c.text.replace(/\s+/g, " ").includes(head)))
        out.cut.push(`${s.slice(0, 50)} [${(t.closest('[data-edit]') && t.closest('[data-edit]').dataset.edit) || (t.dataset.computed ? 'computed:' + t.dataset.computed : '?')}]`);
    }
    const inFoot = foot.contains(t);
    const gy = { top: b.y + b.h * 0.16, bot: b.y + b.h * 0.84 };
    if (
      b.x < -2 ||
      b.x + b.w > W + 2 ||
      gy.top < -2 ||
      gy.bot > H + 2 ||
      (!inFoot && gy.bot > GRID.foot + 4)
    )
      out.off.push(
        `${s.slice(0, 40)} @${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}` + ` [${(t.closest("[data-edit]") && t.closest("[data-edit]").dataset.edit) || "?"}]`,
      );
  }
  return out;
}

/** Run one case: {id, params, mustCard?: [names], mustNotSay?: [words]}. */
export async function runCase(c) {
  const host = document.getElementById("host");
  host.textContent = "";
  const m = await load(c.id);
  const P = withDefaults(
    m.params,
    c.preset
      ? Object.assign({}, m.presets.find((p) => p.id === c.preset).params, c.params)
      : c.params,
  );
  let v;
  try {
    v = m.validate(P);
  } catch (e) {
    return { id: c.id, label: c.label, threw: "validate: " + e.message };
  }
  if (!v.ok)
    return {
      id: c.id,
      label: c.label,
      refused: v.refusals
        .map((r) => r.reason)
        .join(" | ")
        .slice(0, 300),
    };
  let st;
  try {
    if (m.prepare) await m.prepare(P); // models with baked data (river_real) load it first
    st = mountSlide(host, m, P, { theme: "primary" });
  } catch (e) {
    return { id: c.id, label: c.label, threw: "render: " + e.message };
  }
  const res = {
    id: c.id,
    label: c.label,
    cut: [],
    off: [],
    wrongArt: [],
    altMiss: [],
    said: [],
    notCard: [],
  };
  try {
    for (const k of [st.N, 0]) {
      st.show(k, true);
      const r = measureBuild(st, P);
      res.cut.push(...r.cut);
      res.off.push(...r.off);
    }
  } catch (e) {
    res.threw = "show: " + e.message;
  }
  const drawn = st.drawn || [];
  const alt = st.alt || "";
  for (const d of drawn) if (!alt.includes(d.name)) res.altMiss.push(d.name);
  // the captions a teacher sees, every build
  const caps = [];
  for (let k = 0; k <= st.N; k++) caps.push(st.caption(k));
  const said = (caps.join(" ") + " " + alt).toLowerCase();
  for (const w of c.mustNotSay || [])
    if (new RegExp(`\\b${w}\\b`, "i").test(said)) res.said.push(w);
  for (const n of c.mustCard || [])
    // its own cut-out from the shared library, or a card: never another thing's art
    if (!drawn.some((d) => (d.as === "card" || String(d.as).startsWith("library:")) && d.name.toLowerCase().includes(n.toLowerCase())))
      res.notCard.push(n);
  res.drawn = drawn;
  res.cut = [...new Set(res.cut)];
  res.off = [...new Set(res.off)];
  if (c.keep) st.still();
  else st.destroy();
  return res;
}

/** The generic corpus for one model: each preset, each variant, at the fewest and the most items. */
export async function casesFor(id) {
  const m = await load(id);
  const out = [];
  for (const pr of m.presets) {
    const base = withDefaults(m.params, pr.params);
    out.push({ id, label: `${pr.id} as is`, params: base });
    for (const [vn, f] of Object.entries(variants))
      for (const which of ["min", "max"]) {
        offI = 0;
        out.push({
          id,
          label: `${pr.id} ${vn} ${which}`,
          params: Object.assign(mutate(m.params, base, f, sizeTo(which)), { text: {} }),
        });
      }
  }
  return out;
}

/** The longest wording (in letters) a field's lane holds in a case without a cut or a box off the
 *  slide: every string whose params path matches `pathRe` is set to that many letters. Used to set a
 *  field's maxLength to what its lane really holds, so longer wording is refused, never clipped. */
export async function laneFit(id, label, pathRe, lens = [40, 36, 32, 30, 28, 26, 24, 22, 20, 18, 16, 14, 12]) {
  const all = await casesFor(id);
  const c = all.find((x) => x.label === label);
  if (!c) return { id, label, error: "no case" };
  const re = new RegExp(pathRe);
  const set = (v, path, L) => {
    if (Array.isArray(v)) return v.map((x, i) => set(x, `${path}.${i}`, L));
    if (v && typeof v === "object") {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = set(x, path ? `${path}.${k}` : k, L);
      return o;
    }
    return typeof v === "string" && re.test(path) ? longText(L) : v;
  };
  const tried = [];
  for (const L of lens) {
    const r = await runCase({ id, label: `${label} @${L}`, params: set(c.params, "", L) });
    const bad = !!(r.threw || (!r.refused && (r.cut.some((x) => /\[[^\]]*\]$/.test(x) && re.test(x.match(/\[([^\]]*)\]$/)[1])) || r.off.length)));
    tried.push([L, r.refused ? "refused" : bad ? "clips" : "fits"]);
    if (!bad && !r.refused) return { id, label, pathRe, fits: L, tried };
  }
  return { id, label, pathRe, fits: null, tried };
}

/** Present-style stepping check: from the still, Back and every jump must land at once (no running
 *  transition, every build mark already at its end state), and forward steps must still animate unless
 *  reduced motion is on. Returns {id, back: [...], jumps: [...], forward}. */
export async function jumpCheck(id) {
  const host = document.getElementById("host"); host.textContent = "";
  const m = await load(id);
  const P = withDefaults(m.params, m.presets[0].params);
  if (m.prepare) await m.prepare(P);
  const st = mountSlide(host, m, P, { theme: "primary" });
  const running = () => { void st.slide.getBoundingClientRect(); getComputedStyle(st.slide).opacity; return st.slide.getAnimations({ subtree: true }).filter((a) => a.playState === "running" && !(a.effect && a.effect.getTiming && a.effect.getTiming().iterations === Infinity) /* ambient loops (rain, rivers) are not build moves */ && (!a.effect || !a.effect.getComputedTiming || a.effect.getComputedTiming().progress < 1)).length; };
  const out = { id, N: st.N, back: [], jumps: [], forward: null };
  st.show(0, true); st.next(); out.forward = running();
  for (let k = st.N; k > 0; k--) { st.show(k, true); st.prev(); out.back.push(running()); }
  for (let k = 0; k <= st.N; k++) { st.show(k, true); out.jumps.push(running()); }
  st.destroy();
  return out;
}
