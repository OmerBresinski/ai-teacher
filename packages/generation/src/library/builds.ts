/**
 * A library model's builds in Present (TEACH-247 part p): the kit's `data-s` / `data-h` / `data-c`
 * steps turned into the frames `svgAtBuild` plays, from an opening frame that already shows the
 * picture. Everything here works on the kit's mounted drawing at its last build.
 */
import type { Element } from "happy-dom";

const SKIP = "defs,clipPath,clippath,mask,marker,pattern,symbol,style,title,desc";
/** Tags that draw nothing (defs, styles, metadata). */
export const SKIP_TAGS = SKIP.toLowerCase().split(",");

/** A mark's `data-c` ranges that hide it ("a-z:off": from build a until build z). */
function offRanges(el: Element): [number, number][] {
  return (el.getAttribute("data-c") ?? "").split(",").flatMap((part) => {
    const m = /^(\d+)-(\d+):off$/.exec(part.trim());
    return m ? [[Number(m[1]), Number(m[2])] as [number, number]] : [];
  });
}

/**
 * Runs `f` with the drawing as the kit shows it at build `k` (kit/build.js `apply`: a mark with
 * `data-s` shows from its build, one with `data-h` leaves at its build). A mark the last frame
 * hides stays hidden: it is not in the stored drawing, so no frame of it may count on it. A mark
 * the question restores (`data-qn`) counts as the question shows it.
 */
function atKitStep<T>(svg: Element, k: number, f: () => T): T {
  const els = [...svg.querySelectorAll("[data-s],[data-h],[data-c]")];
  const was = els.map((e) => e.classList.contains("off"));
  for (const [i, e] of els.entries()) {
    const s = e.getAttribute("data-s");
    const h = e.hasAttribute("data-qn") ? null : e.getAttribute("data-h");
    const off =
      (s !== null && k < Number(s)) ||
      (h !== null && k >= Number(h)) ||
      offRanges(e).some(([a, z]) => k >= a && k < z);
    // Off at the end for another reason (a class range, a live mark): off in every frame.
    e.classList.toggle("off", (Boolean(was[i]) && h === null) || off);
  }
  try {
    return f();
  } finally {
    for (const [i, e] of els.entries()) e.classList.toggle("off", Boolean(was[i]));
  }
}

/** How many words are visible: texts with letters, outside the foot and hidden marks. */
function visibleWords(svg: Element, foot: Element | null): number {
  let n = 0;
  const walk = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.includes(tag) || el === foot) return;
    if (el.classList.contains("off") || el.classList.contains("live")) return;
    if (tag === "text") {
      if ((el.textContent ?? "").trim()) n += 1;
      return;
    }
    for (const c of el.children) walk(c);
  };
  for (const c of svg.children) walk(c);
  return n;
}

/** The share of the finished drawing's width or height the opening frame must already span. */
export const OPEN_SPAN = 0.6;
export type Box = { x0: number; y0: number; x1: number; y1: number };
/** The drawn area of the marks not hidden (`render.ts` `drawnBox`). */
export type Measure = (svg: Element, foot: Element | null) => Box | undefined;

/**
 * A model's opening frame in Present must show the picture, not a blank box (the kit plays its
 * builds from an empty stage). It is the earliest kit build whose visible marks already span
 * OPEN_SPAN of the finished drawing's width or height and carry at least one word; the builds
 * before it are shown from the start. Returns `last` when no earlier build qualifies: the model
 * is then a still.
 */
function openingStep(
  svg: Element,
  foot: Element | null,
  last: number,
  full: Box,
  measure: Measure,
): number {
  const fw = full.x1 - full.x0;
  const fh = full.y1 - full.y0;
  for (let k = 0; k < last; k++) {
    const ok = atKitStep(svg, k, () => {
      const b = measure(svg, foot);
      if (!b || visibleWords(svg, foot) < 1) return false;
      return (b.x1 - b.x0) / fw >= OPEN_SPAN || (b.y1 - b.y0) / fh >= OPEN_SPAN;
    });
    if (ok) return k;
  }
  return last;
}

/**
 * Tags the mounted drawing (at its last build) with the frames Present plays (TEACH-247 part p).
 * Frame 0 is the opening frame; each later frame is a kit build that adds or removes a mark, up to
 * the last build before the answer (`q`, a question slide) or the finished drawing. A kit build
 * that changes no mark (a caption or a recolour only) is not a frame, so no Next shows nothing.
 * A mark that stays gets `data-s` = the frame it arrives in (none when it is there from the
 * start); one first shown after `q` is the answer (`data-reveal`). A mark that comes and goes
 * before the end (`data-h`, "One pizza" before the cut) gets `data-f` = the frames it shows in,
 * and is hidden on every other surface. A mark the kit hides for a while and brings back (a
 * `data-c` "a-z:off" range) gets `data-x` = the frames it is away in. A ghost (a trail the kit shows once it stops playing)
 * arrives with the finished drawing. With `still` every frame before the last is the opening one:
 * no builds, the drawing as it ends. Returns how many frames follow the opening one.
 */
export function tagBuilds(
  svg: Element,
  foot: Element | null,
  box: Box,
  q: number | undefined,
  opts: { measure: Measure; still?: boolean },
): number {
  const last = q ?? Number.POSITIVE_INFINITY;
  const els = [...svg.querySelectorAll("[data-s],[data-h]")];
  const sOf = (el: Element) => Number(el.getAttribute("data-s") ?? 0);
  const off = (el: Element) => el.classList.contains("off");
  const passing = els.filter((el) => off(el) && el.hasAttribute("data-h"));
  // The kit's last change: the finished drawing.
  const end = Math.max(
    0,
    ...els.map(sOf),
    ...passing.map((el) => Number(el.getAttribute("data-h"))),
  );
  if (q === undefined)
    for (const el of [...svg.querySelectorAll(".ghost")]) el.setAttribute("data-s", String(end));
  const top = Math.min(last, end);
  const opening = opts.still ? top : openingStep(svg, foot, top, box, opts.measure);
  const kept = [...svg.querySelectorAll("[data-s],[data-h]")].filter((el) => !off(el));
  // Marks the kit hides for a while and brings back (a list that takes the stage for one build).
  const away = [...svg.querySelectorAll("[data-c]")].filter(
    (el) => !off(el) && offRanges(el).length,
  );
  const changes = new Set<number>();
  for (const el of kept) changes.add(sOf(el));
  for (const el of away) for (const [a, z] of offRanges(el)) changes.add(a).add(z);
  for (const el of passing) changes.add(sOf(el)).add(Number(el.getAttribute("data-h")));
  const frames = [opening, ...[...changes].filter((k) => k > opening && k <= top)].sort(
    (a, b) => a - b,
  );
  for (const el of kept) {
    const s = sOf(el);
    el.removeAttribute("data-s");
    el.removeAttribute("data-h");
    if (s > last) el.setAttribute("data-reveal", "1");
    else if (s > opening) el.setAttribute("data-s", String(frames.findIndex((k) => k >= s)));
  }
  for (const el of away) {
    const hid = frames.flatMap((k, i) =>
      offRanges(el).some(([a, z]) => k >= a && k < z) ? [i] : [],
    );
    if (hid.length) el.setAttribute("data-x", hid.join(" "));
  }
  for (const el of passing) {
    const s = sOf(el);
    const h = Number(el.getAttribute("data-h"));
    const on = frames.flatMap((k, i) => (k >= s && k < h ? [i] : []));
    el.removeAttribute("data-s");
    el.removeAttribute("data-h");
    if (!on.length) continue;
    el.classList.remove("off");
    el.setAttribute("data-f", on.join(" "));
  }
  return frames.length - 1;
}

/**
 * Present hides a later build, the answer or what it replaces by its attribute
 * (`[data-s="2"]{opacity:0}`); a kit class on the same mark (`.slide .soft`) would outrank that rule
 * and show it early. Such a mark goes inside a plain group that carries the attribute instead; the
 * mark keeps its own class and transform. Safe because no kit or model rule selects on structure
 * (child, sibling or nth selectors), which `present-builds.test.ts` checks on every shipped model.
 */
export function wrapClassed(out: Element): void {
  for (const el of [...out.querySelectorAll("[data-s],[data-reveal],[data-qn]")]) {
    if (!el.getAttribute("class")?.trim() || !el.parentNode) continue;
    const g = el.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "g");
    for (const a of ["data-s", "data-reveal", "data-qn"]) {
      const v = el.getAttribute(a);
      if (v === null) continue;
      g.setAttribute(a, v);
      el.removeAttribute(a);
    }
    el.parentNode.insertBefore(g, el);
    g.appendChild(el);
  }
}
