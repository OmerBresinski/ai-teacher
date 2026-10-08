// The build engine (ruling 180): a model is one slide with N builds plus a summary (the still).
// The teacher advances with next, right arrow, space, Enter, Page Down or a clicker; nothing
// runs on a timer. Forward builds animate over about a second; back jumps to the end state of
// the previous build. Earlier annotations recede with data-c ranges. Reduced motion fades in place.

import { GRID } from "./layout.js";
import { cutLog, drawLog, noteCut, resetDrawLog } from "./pictures.js";
import { H, h, measure, T, W, wrap } from "./svg.js";

export const THEMES = ["primary", "secondary", "night", "bold", "riso"];
export const RM = matchMedia("(prefers-reduced-motion: reduce)");
const FONTS = [
  "400 30px Lexend",
  "500 30px Lexend",
  "600 30px Lexend",
  "700 30px Lexend",
  "500 30px Fraunces",
  "600 30px Fraunces",
  "400 30px Inter",
  "500 30px Inter",
  "600 30px Inter",
  "700 30px Inter",
  "600 30px Archivo",
  "700 30px Archivo",
  "800 30px Archivo",
];
/** Resolves when the theme fonts are loaded (or after 3 s), so measured labels are right. */
export const fontsReady = () =>
  Promise.race([
    Promise.all(FONTS.map((f) => document.fonts.load(f))).then(() => document.fonts.ready),
    new Promise((r) => setTimeout(r, 3000)),
  ]);

const LIVE = new Set();
let PACE = 1.6,
  uidN = 0;

/** Width the title may use: up to the first thing the model draws in the title band (any build),
 *  less a gap. Marks that start near the left edge or fill the slide do not narrow it. */
const BAND = "text,rect,circle,ellipse,path,line,polyline,polygon,image,use";
function titleRoom(svg, stage) {
  const sr = svg.getBoundingClientRect();
  let right = GRID.right;
  if (!sr.width) return right - GRID.left;
  const s = sr.width / W,
    x0min = GRID.left + 240,
    bandB = GRID.titleY + 14;
  for (const el of stage.querySelectorAll(BAND)) {
    if (el.closest("defs,clipPath,mask,marker,pattern,symbol")) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const x = (r.left - sr.left) / s,
      y = (r.top - sr.top) / s,
      w = r.width / s,
      hh = r.height / s;
    if (w >= W - 1 || y >= bandB || y + hh <= 0 || x < x0min || x >= right) continue;
    right = x - GRID.gap;
  }
  return right - GRID.left;
}
/** The engine-owned slide title: one line at --fs-title; if it is too wide, one line a step smaller;
 *  then two lines (the second on the usual baseline, the first above it) shrinking towards --fs-min.
 *  An overlong word is broken. Only a title that cannot fit two lines at --fs-min is cut, with a warning. */
function fitTitle(root, s, tok, warn, maxW = GRID.right - GRID.left) {
  const t = T(root, GRID.left, GRID.titleY, s, "ts-title");
  t.dataset.edit = "title";
  if (t.getComputedTextLength() <= maxW) return t;
  const fs = tok("--fs-title") || 46,
    min = tok("--fs-min") || 24;
  const one = Math.round(fs * 0.87);
  t.style.fontSize = one + "px";
  if (t.getComputedTextLength() <= maxW) return t;
  let size = Math.min(34, Math.round(fs * 0.74)),
    L;
  for (; ; size -= 2) {
    if (size < min) size = min;
    L = wrap(root, s, "ts-title", maxW, { style: `font-size:${size}px` });
    if (L.length <= 2 || size === min) break;
  }
  if (L.length > 2) {
    const a = { style: `font-size:${size}px` };
    let last = L.slice(1).join(" ");
    const fits = (x) => measure(root, x + "…", "ts-title", a) <= maxW;
    while (last.includes(" ") && !fits(last)) last = last.replace(/\s*\S*$/, "");
    while (last.length > 1 && !fits(last)) last = last.slice(0, -1);
    L = [L[0], last.trimEnd() + "…"];
    noteCut(s, "title");
    warn(`The title is too long for two lines (${s.length} letters); its end is cut. Shorten it.`);
  }
  const lh = Math.round(size * 1.14);
  t.textContent = "";
  t.style.fontSize = size + "px";
  t.setAttribute("y", L.length > 1 ? GRID.titleY - lh : GRID.titleY);
  L.forEach((x, i) => h("tspan", { x: GRID.left, dy: i ? lh : 0, text: x }, t));
  return t;
}

/**
 * Mount a model on a container. Returns a stage api:
 *   N, k, show(k, instant), next(), prev(), still(), update(params, theme), caption(k), note(k), destroy()
 * opts: { theme, onChange(stage) }
 */
export function mountSlide(container, model, params, opts = {}) {
  const slide = document.createElement("div");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  slide.appendChild(svg);
  container.appendChild(slide);
  const st = { k: 0, playing: false, t0: 0 };
  let els = [],
    cap,
    hooks = {},
    plan,
    notes,
    theme = opts.theme || "primary",
    P = params;
  const api = {
    get cuts() {
      return cutLog();
    },
    slide,
    svg,
    model,
    st,
    get N() {
      return plan.steps.length;
    },
    get k() {
      return st.k;
    },
    get params() {
      return P;
    },
    get theme() {
      return theme;
    },
  };
  // captions and notes are overridable per build through params.text['caption:<key>'] / ['note:<key>']
  const ov = (id) => (P.text && P.text[id] != null && P.text[id] !== "" ? P.text[id] : null);
  const capKey = (k) => (k >= plan.steps.length ? "summary" : plan.steps[k].key);
  const capOf = (k) =>
    ov("caption:" + capKey(k)) ??
    (k >= plan.steps.length ? plan.summary.caption : plan.steps[k].caption);
  const noteOf = (k) =>
    ov("note:" + capKey(k)) ?? (k >= plan.steps.length ? notes.summary : notes.steps[k]);

  function build() {
    slide.className = `slide tk theme-${theme}`;
    PACE = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pace")) || 1.6;
    plan = model.builds(P);
    notes = model.notes(P);
    svg.textContent = "";
    svg.setAttribute("aria-label", `${model.meta.name}: ${P.title || ""}`);
    const tok = (n) => parseFloat(getComputedStyle(slide).getPropertyValue(n));
    const b = {};
    plan.steps.forEach((s, i) => {
      b[s.key] = i;
    });
    const N = plan.steps.length;
    api.warnings = [];
    const ctx = {
      warn: (m) => api.warnings.push(m),
      name: theme,
      slide,
      svg,
      uid: "m" + ++uidN,
      N,
      b,
      tk: {
        head: tok("--head"),
        pillH: tok("--pill-h"),
        pillPad: tok("--pill-pad"),
        edge: tok("--space-edge"),
        gap: tok("--label-gap"),
      },
      /** class range for receding: rc('a') = quiet from the build after a until the summary */
      rc(from, to, cls = "quiet") {
        const a = typeof from === "number" ? from : b[from] + 1;
        const z = to == null ? N : typeof to === "number" ? to : b[to];
        return a < z ? `${a}-${z}:${cls}` : null;
      },
    };
    const root = h("g", {}, svg);
    h("rect", { x: 0, y: 0, width: W, height: H, fill: "var(--bg)" }, root);
    const stage = h("g", {}, root);
    resetDrawLog();
    hooks = model.render(stage, P, ctx) || {};
    api.drawn = drawLog();
    const foot = h("g", {}, root);
    h("rect", { x: 0, y: GRID.foot, width: W, height: H - GRID.foot, fill: "var(--bg)" }, foot);
    h(
      "line",
      {
        x1: GRID.left,
        x2: GRID.right,
        y1: GRID.foot,
        y2: GRID.foot,
        stroke: "var(--rule)",
        "stroke-width": "var(--sw-rule)",
      },
      foot,
    );
    cap = T(foot, GRID.left, GRID.captionY, "", "caption");
    if (P.title && !hooks.noTitle) fitTitle(root, P.title, tok, ctx.warn, titleRoom(svg, stage));
    const defs = h("defs", {}, root);
    const f = h("filter", { id: "gr-" + ctx.uid, x: 0, y: 0, width: "100%", height: "100%" }, defs);
    h(
      "feTurbulence",
      {
        type: "fractalNoise",
        baseFrequency: ".9",
        numOctaves: "2",
        stitchTiles: "stitch",
        seed: "4",
      },
      f,
    );
    h("feColorMatrix", { type: "saturate", values: "0" }, f);
    h(
      "rect",
      { x: 0, y: 0, width: W, height: H, filter: `url(#gr-${ctx.uid})`, cls: "grain" },
      root,
    );
    els = [...svg.querySelectorAll("[data-s],[data-h],[data-c]")];
    setAlt();
  }
  // Alt text is built from what is on the slide: the title, the summary caption (the model builds it
  // from the data it draws), each named picture as it is drawn, and the words drawn on the stage.
  function altText() {
    const words = [];
    const seen = new Set();
    for (const t of api.svg.querySelectorAll("text")) {
      if (cap && (t === cap || cap.contains(t))) continue;
      const s = (t.textContent || "").replace(/\s+/g, " ").trim();
      if (!s || seen.has(s) || s === P.title) continue;
      seen.add(s);
      words.push(s);
    }
    const pics = (api.drawn || []).map((d) =>
      d.as === "card" ? `${d.name} (a labelled card)` : d.name,
    );
    const parts = [`${model.meta.name}${P.title ? ": " + P.title : ""}.`, capOf(plan.steps.length)];
    if (pics.length) parts.push(`Pictures: ${[...new Set(pics)].join(", ")}.`);
    if (words.length) parts.push(`Labels: ${words.slice(0, 40).join("; ")}.`);
    return parts.filter(Boolean).join(" ");
  }
  function setAlt() {
    api.alt = altText();
    svg.setAttribute("aria-label", api.alt);
  }
  // data-c parts: "k:cls" from build k on, "k-j:cls" builds k to j-1 (j = N means "not in the summary")
  function apply(k) {
    for (const el of els) {
      const s = el.dataset.s,
        hh = el.dataset.h;
      el.classList.toggle("off", (s !== undefined && k < +s) || (hh !== undefined && k >= +hh));
      if (el.dataset.c) {
        const on = {}; // several ranges may name one class: it is on if any range covers k
        for (const part of el.dataset.c.split(",")) {
          const [r, c] = part.split(":");
          const [a, z] = r.split("-");
          on[c] = on[c] || (k >= +a && (z === undefined || k < +z));
        }
        for (const c in on) el.classList.toggle(c, on[c]);
      }
    }
  }
  // caption line: one line at --fs-cap; a long one shrinks to --fs-min, then wraps to two lines above
  // the baseline (an overlong word is broken). Past two lines the end is cut with "…" and a warning.
  function setCap(k) {
    cap.textContent = capOf(k);
    cap.dataset.edit = "text.caption:" + capKey(k);
  }
  function fit() {
    const maxW = GRID.right - GRID.left,
      s = cap.textContent;
    cap.style.fontSize = "";
    cap.setAttribute("y", GRID.captionY);
    if (cap.getComputedTextLength() <= maxW) return;
    cap.style.fontSize = "var(--fs-min)";
    if (cap.getComputedTextLength() <= maxW) return;
    const a = { style: "font-size:var(--fs-min)" },
      foot = cap.parentNode;
    let L = wrap(foot, s, "caption", maxW, a);
    if (L.length > 2) {
      let last = L.slice(1).join(" ");
      const fits = (t) => measure(foot, t + "…", "caption", a) <= maxW;
      while (last.includes(" ") && !fits(last)) last = last.replace(/\s*\S*$/, "");
      while (last.length > 1 && !fits(last)) last = last.slice(0, -1);
      L = [L[0], last.trimEnd() + "…"];
      noteCut(s, "caption");
      const m = `The caption for this build is too long for two lines (${s.length} letters); its end is cut. Shorten it.`;
      if (!api.warnings.includes(m)) api.warnings.push(m);
    }
    cap.textContent = "";
    L.forEach((t, i) => h("tspan", { x: GRID.left, dy: i ? 26 : 0, text: t }, cap));
    if (L.length > 1) cap.setAttribute("y", GRID.captionY - 14);
  }
  function show(k, instant) {
    const N = plan.steps.length;
    k = Math.max(0, Math.min(N, k));
    if (instant) slide.classList.add("instant");
    if (k >= N) {
      st.playing = false;
      slide.classList.remove("playing");
      apply(N);
      hooks.still && hooks.still();
      setCap(k);
    } else {
      if (!st.playing) {
        slide.classList.add("playing", "instant");
        apply(-1);
        hooks.reset && hooks.reset();
        void slide.getBoundingClientRect();
        if (!instant) slide.classList.remove("instant");
        st.playing = true;
      }
      st.t0 = performance.now() - (instant ? 1e8 : 0);
      apply(k);
      setCap(k);
      hooks.onStep && hooks.onStep(k);
      if ((RM.matches || instant) && hooks.tick) hooks.tick(k, 1, performance.now() / 1000, 0);
    }
    st.k = k;
    fit();
    if (instant) {
      void slide.getBoundingClientRect();
      slide.classList.remove("instant");
    }
    opts.onChange && opts.onChange(api);
  }
  Object.assign(api, {
    show,
    next() {
      if (st.k < plan.steps.length) {
        show(st.k + 1, false);
        return true;
      }
      return false;
    },
    prev() {
      if (st.k > 0) {
        show(st.k - 1, true);
        return true;
      }
      return false;
    },
    still() {
      show(plan.steps.length, true);
    },
    update(params, th) {
      if (params) P = params;
      if (th) theme = th;
      build();
      show(plan.steps.length, true);
    },
    caption: (k = st.k) => capOf(k),
    note: (k = st.k) => noteOf(k),
    noteId: (k = st.k) => "text.note:" + capKey(k),
    tickNow(t, dt) {
      if (!st.playing || !hooks.tick || st.k >= plan.steps.length || RM.matches) return;
      const key = plan.steps[st.k].key;
      const dur = (hooks.dur && hooks.dur[key]) || 1500;
      try {
        hooks.tick(st.k, Math.min(1, (performance.now() - st.t0) / (dur * PACE)), t, dt);
      } catch (e) {
        console.error(model.meta.id, e);
      }
    },
    destroy() {
      LIVE.delete(api);
      slide.remove();
    },
  });
  build();
  show(plan.steps.length, true);
  LIVE.add(api);
  return api;
}

let lastT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const t = now / 1000,
    dt = Math.min(0.05, t - (lastT || t));
  lastT = t;
  for (const s of LIVE) s.tickNow(t, dt);
}
requestAnimationFrame(loop);
RM.addEventListener && RM.addEventListener("change", () => LIVE.forEach((s) => s.still()));

/** Present mode: full screen, keyboard and clicker control, a small build count in the corner.
 *  S toggles the speaker notes strip; Esc leaves. Starts at build 1. */
export const Presenter = (() => {
  let pv,
    stageEl,
    countEl,
    notesEl,
    cur = null,
    home = null,
    showNotes = false;
  function ensure() {
    if (pv) return;
    pv = document.createElement("div");
    pv.className = "pv";
    pv.hidden = true;
    pv.innerHTML =
      '<div class="pv-stage"></div><div class="pv-notes" hidden></div><div class="pv-count"></div><button type="button" class="pv-close">Close (Esc) · Notes (S)</button>';
    document.body.appendChild(pv);
    stageEl = pv.querySelector(".pv-stage");
    countEl = pv.querySelector(".pv-count");
    notesEl = pv.querySelector(".pv-notes");
    document.addEventListener("keydown", (e) => {
      if (!cur) return;
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n", "N"].includes(e.key)) {
        e.preventDefault();
        cur.next();
        paint();
      } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p", "P"].includes(e.key)) {
        e.preventDefault();
        cur.prev();
        paint();
      } else if (e.key === "s" || e.key === "S") {
        showNotes = !showNotes;
        paint();
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement && cur) close();
    });
    pv.addEventListener("click", (e) => {
      if (e.target.closest(".pv-close")) {
        close();
        return;
      }
      cur && cur.next();
      paint();
    });
  }
  function paint() {
    if (!cur) return;
    countEl.textContent = `${cur.k + 1} / ${cur.N + 1}`;
    notesEl.hidden = !showNotes;
    notesEl.textContent = cur.note();
  }
  function open(S, k = 0) {
    ensure();
    cur = S;
    home = [S.slide.parentNode, S.slide.nextSibling];
    stageEl.appendChild(S.slide);
    pv.hidden = false;
    if (pv.requestFullscreen) pv.requestFullscreen().catch(() => {});
    S.show(k, k !== 0);
    paint();
  }
  function close() {
    if (!cur) return;
    const S = cur;
    home[0].insertBefore(S.slide, home[1]);
    S.still();
    cur = null;
    pv.hidden = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  return {
    open,
    close,
    get cur() {
      return cur;
    },
  };
})();
