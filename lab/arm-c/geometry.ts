// Arm C: the DOM geometry check (ReDeck's violation families plus min font and broken images).
// Runs in the page; returns numbers and element names, never a picture.
export interface Violation {
  type: string;
  element: string;
  other?: string;
  px: number;
  detail: string;
}
export interface Geometry {
  total: number;
  counts: Record<string, number>;
  violations: Violation[];
  boxes: { element: string; x: number; y: number; w: number; h: number }[];
}

export function check(args: { minFont: number }): Geometry {
  const W = 1920,
    H = 1080,
    TOL = 2;
  const root = document.getElementById("slide")!;
  const out: Violation[] = [];
  const names = new Map<Element, string>();
  let auto = 0;
  const all = [...root.querySelectorAll("*")];
  const visible = (el: Element) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0)
      return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const ownText = (el: Element) =>
    [...el.childNodes].filter((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
  const name = (el: Element) => {
    if (el.id) return el.id;
    if (!names.has(el))
      names.set(
        el,
        `auto-${el.tagName.toLowerCase()}-${++auto} "${(el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30)}"`,
      );
    return names.get(el)!;
  };
  type R = { l: number; t: number; r: number; b: number };
  const rectOf = (el: Element): R => {
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom };
  };
  const textRect = (el: Element): R | undefined => {
    let u: R | undefined;
    for (const n of ownText(el)) {
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const q of rg.getClientRects()) {
        if (q.width === 0 || q.height === 0) continue;
        u = u
          ? {
              l: Math.min(u.l, q.left),
              t: Math.min(u.t, q.top),
              r: Math.max(u.r, q.right),
              b: Math.max(u.b, q.bottom),
            }
          : { l: q.left, t: q.top, r: q.right, b: q.bottom };
      }
    }
    if (!u) return u;
    // Glyph boxes (the font's content area) stand taller than a tight line box (line-height under
    // about 1.3); trim that overshoot so a title at line-height 1.06 is not read as overflowing.
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight);
    const rg = document.createRange();
    rg.selectNodeContents(ownText(el)[0]);
    const area = rg.getClientRects()[0]?.height ?? 0;
    const over = Number.isFinite(lh) && area > lh ? (area - lh) / 2 : 0;
    return { l: u.l, t: u.t + over, r: u.r, b: u.b - over };
  };
  const inDiagram = (el: Element) =>
    !!el.closest("[data-diagram]") && !el.matches("[data-diagram]");
  const isMedia = (el: Element) =>
    el.matches("img,video,canvas,[data-diagram]") ||
    (el.tagName.toLowerCase() === "svg" && !el.parentElement?.closest("svg"));
  const hasPanel = (el: Element) => {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    const hasBg =
      (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) || cs.backgroundImage !== "none";
    const hasBorder = ["Top", "Right", "Bottom", "Left"].some(
      (s) =>
        parseFloat((cs as any)[`border${s}Width`]) > 0 && (cs as any)[`border${s}Style`] !== "none",
    );
    return hasBg || hasBorder;
  };
  const back = (el: Element) =>
    el.closest('[data-layer="back"]') !== null && ownText(el).length === 0;
  // Content items: text-bearing elements, media, and panels (visible background or border).
  type Item = { el: Element; box: R; text: boolean; media: boolean; panel: boolean };
  const items: Item[] = [];
  for (const el of all) {
    if (inDiagram(el) || !visible(el)) continue;
    const tr = ownText(el).length ? textRect(el) : undefined;
    const media = isMedia(el);
    const panel = !media && !tr && hasPanel(el);
    if (!tr && !media && !panel) continue;
    items.push({ el, box: tr ?? rectOf(el), text: !!tr, media, panel });
  }
  const push = (v: Violation) => out.push({ ...v, px: Math.round(v.px) });
  const sticks = (a: R, b: R) => Math.max(b.l - a.l, a.r - b.r, b.t - a.t, a.b - b.b);
  for (const it of items) {
    // off canvas
    const off = Math.max(-it.box.l, it.box.r - W, -it.box.t, it.box.b - H);
    if (off > TOL) {
      push({
        type: "off_canvas",
        element: name(it.el),
        px: off,
        detail: `content reaches ${Math.round(it.box.l)},${Math.round(it.box.t)} to ${Math.round(it.box.r)},${Math.round(it.box.b)}; the canvas is 0,0 to 1920,1080`,
      });
      continue;
    }
    // own box (text only) then sized ancestors
    let done = false;
    if (it.text) {
      const own = rectOf(it.el);
      const d = sticks(it.box, own);
      const cs = getComputedStyle(it.el);
      const clips =
        cs.overflow !== "visible" ||
        cs.textOverflow === "ellipsis" ||
        (cs as any).webkitLineClamp !== "none";
      if (d > TOL) {
        push({
          type: clips ? "clipping" : "overflow",
          element: name(it.el),
          px: d,
          detail: `text runs ${Math.round(d)}px outside its box (box ${Math.round(own.t)}..${Math.round(own.b)} high, text ${Math.round(it.box.t)}..${Math.round(it.box.b)})`,
        });
        done = true;
      } else if (
        clips &&
        (it.el.scrollHeight > it.el.clientHeight + TOL ||
          it.el.scrollWidth > it.el.clientWidth + TOL)
      ) {
        const hid = Math.max(
          it.el.scrollHeight - it.el.clientHeight,
          it.el.scrollWidth - it.el.clientWidth,
        );
        push({
          type: "clipping",
          element: name(it.el),
          px: hid,
          detail: `${hid}px of its text is hidden (overflow ${cs.overflow}${cs.textOverflow === "ellipsis" ? ", ellipsis" : ""})`,
        });
        done = true;
      }
    }
    for (let a = it.el.parentElement; a && a !== root && !done; a = a.parentElement) {
      if (
        getComputedStyle(a).display.startsWith("inline") &&
        !getComputedStyle(a).display.includes("block")
      )
        continue;
      const ab = rectOf(a);
      const d = sticks(it.box, ab);
      if (d > TOL) {
        const ov = getComputedStyle(a).overflow;
        const clip = ov !== "visible";
        push({
          type: clip ? "clipping" : "overflow",
          element: name(it.el),
          other: name(a),
          px: d,
          detail: clip
            ? `${Math.round(d)}px cut off by ${name(a)} (overflow ${ov})`
            : `runs ${Math.round(d)}px outside ${name(a)}`,
        });
        done = true;
      }
    }
    if (it.text) {
      const fs = parseFloat(getComputedStyle(it.el).fontSize);
      if (fs < args.minFont - 0.5)
        push({
          type: "min_font",
          element: name(it.el),
          px: fs,
          detail: `font ${fs}px; the smallest allowed is ${args.minFont}px`,
        });
    }
  }
  // overlap: pairs not nested, neither a backdrop
  const cand = items.filter((i) => !back(i.el));
  for (let i = 0; i < cand.length; i++)
    for (let j = i + 1; j < cand.length; j++) {
      const a = cand[i],
        b = cand[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (a.panel && b.text && a.el.contains(b.el)) continue;
      const w = Math.min(a.box.r, b.box.r) - Math.max(a.box.l, b.box.l);
      const h = Math.min(a.box.b, b.box.b) - Math.max(a.box.t, b.box.t);
      if (w <= TOL || h <= TOL) continue;
      // a text item over a panel that is an ancestor of it is fine; a panel over its own descendants too (handled by contains)
      push({
        type: "overlap",
        element: name(a.el),
        other: name(b.el),
        px: Math.min(w, h),
        detail: `${name(a.el)} and ${name(b.el)} overlap by ${Math.round(w)}x${Math.round(h)}px`,
      });
    }
  // SVG text (tool diagrams and any inline SVG): the item loop above skips diagram internals, so a
  // label cut by its SVG's edge passed the gate (C y1, 6 Oct: "sheep", "lamb"). Each <text> is
  // checked against every enclosing SVG viewport (SVG clips at its box), the canvas, and the floor.
  for (const t of root.querySelectorAll("svg text")) {
    if (!visible(t)) continue;
    const q = t.getBoundingClientRect();
    const tb: R = { l: q.left, t: q.top, r: q.right, b: q.bottom };
    const label = (t.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
    if (!label) continue;
    const host = t.closest("[data-diagram]") ?? t.closest("svg")!;
    const who = `${name(host)} label "${label}"`;
    const ctm = (t as SVGGraphicsElement).getScreenCTM();
    const scale = ctm ? Math.hypot(ctm.a, ctm.b) : 1;
    const fs = parseFloat(getComputedStyle(t).fontSize) * scale;
    // A <text> box includes the font's full ascent and descent; only ink past that slack is cut.
    const vs = 0.3 * fs;
    const past = (a: R, b: R) => Math.max(b.l - a.l, a.r - b.r, b.t - a.t - vs, a.b - b.b - vs);
    const off = Math.max(-tb.l, tb.r - W, -tb.t - vs, tb.b - H - vs);
    if (off > TOL) {
      push({
        type: "off_canvas",
        element: who,
        px: off,
        detail: `diagram label reaches outside the canvas by ${Math.round(off)}px`,
      });
      continue;
    }
    for (let s = t.parentElement?.closest("svg"); s; s = s.parentElement?.closest("svg") ?? null) {
      if (getComputedStyle(s).overflow === "visible") continue;
      const d = past(tb, rectOf(s));
      if (d > TOL) {
        push({
          type: "clipping",
          element: who,
          other: name(host),
          px: d,
          detail: `${Math.round(d)}px of the label is cut off by the diagram's edge; give the diagram more room or redraw it larger`,
        });
        break;
      }
    }
    if (fs < args.minFont - 0.5)
      push({
        type: "min_font",
        element: who,
        px: Math.round(fs),
        detail: `diagram label drawn at ${Math.round(fs)}px; the smallest allowed is ${args.minFont}px; draw the diagram larger`,
      });
  }
  // broken images
  for (const img of root.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    if (!/^assets\//.test(src))
      push({
        type: "broken_image",
        element: name(img),
        px: 0,
        detail: `src "${src.slice(0, 60)}" is not a picture or diagram from a tool`,
      });
    else if (!img.complete || img.naturalWidth === 0)
      push({ type: "broken_image", element: name(img), px: 0, detail: `"${src}" did not load` });
  }
  const counts: Record<string, number> = {
    overflow: 0,
    clipping: 0,
    overlap: 0,
    off_canvas: 0,
    min_font: 0,
    broken_image: 0,
  };
  for (const v of out) counts[v.type]++;
  const boxes = all
    .filter((e) => e.id && !inDiagram(e))
    .slice(0, 40)
    .map((e) => {
      const r = e.getBoundingClientRect();
      return {
        element: e.id,
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    });
  const order = (v: Violation) => (v.type === "broken_image" ? 1e6 : v.px);
  return {
    total: out.length,
    counts,
    violations: out.sort((x, y) => order(y) - order(x)).slice(0, 20),
    boxes,
  };
}
