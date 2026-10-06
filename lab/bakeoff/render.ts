// BAKEOFF shared renderer: lesson.json -> render/slide-NN.png at 1440x810, light theme, through the
// real present view (lab/onecall web dev server, API answered here; photos from the bake-off store).
// Needs: `VITE_API_URL=http://localhost:3936 bun --bun vite --port 4936` in apps/web (BAKEOFF/HARNESS.md).
// Usage: bun lab/bakeoff/render.ts <lesson.json> [outDir]   (outDir defaults to <lesson dir>/render)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "../../apps/web/node_modules/@playwright/test/index.mjs";
import { STORE } from "./services";

const API = process.env.BAKEOFF_API ?? "http://localhost:3936";
const WEB = process.env.BAKEOFF_WEB ?? "http://localhost:4936";

export async function renderLesson(file: string, out = `${dirname(file)}/render`) {
  const now = new Date().toISOString();
  const user = {
    id: "u-mock",
    email: "mock@example.com",
    name: "Mock",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  };
  const body = JSON.parse(readFileSync(file, "utf8"));
  body.updatedAt = now;
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 810 },
    colorScheme: "light",
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("tj-theme", "light");
    } catch {}
  });
  const page = await ctx.newPage();
  await page.route(`${API}/**`, async (route: any) => {
    const p = new URL(route.request().url()).pathname;
    const json = (b: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (p.startsWith("/files/")) {
      const f = Bun.file(`${STORE}/${decodeURIComponent(p.replace(/^\/files\//, ""))}`);
      if (await f.exists())
        return route.fulfill({ body: Buffer.from(await f.arrayBuffer()), contentType: f.type });
      return route.fulfill({ status: 404, body: "" });
    }
    if (p.includes("get-session"))
      return json({
        session: {
          id: "s",
          userId: user.id,
          token: "t",
          expiresAt: "2099-01-01T00:00:00.000Z",
          createdAt: now,
          updatedAt: now,
        },
        user,
      });
    if (p === "/me")
      return json({
        user: { id: user.id, email: user.email, name: user.name },
        workspaceId: "w-mock",
      });
    if (p === `/documents/${body.id}`)
      return json({
        document: {
          id: body.id,
          kind: "lesson",
          title: body.title,
          createdAt: now,
          updatedAt: now,
          generatingJobId: null,
          archivedAt: null,
          deletedAt: null,
          body,
        },
      });
    return json({});
  });
  const clips: { slide: number; label: string; px: number; detail: string }[] = [];
  // The ruler measures what is drawn: text in the rendered present view (round 1: the model-side
  // ruler re-fitted template slides and flagged clean picture cards).
  const dom = { offCanvas: [], overflow: [], overlaps: [] } as Record<
    "offCanvas" | "overflow" | "overlaps",
    { slide: number; detail: string }[]
  >;
  for (let n = 1; n <= body.slides.length; n++) {
    await page.goto(`${WEB}/l/${body.id}/present?slide=${n}`);
    await page
      .getByRole("button", { name: "Stay in this window" })
      .click({ timeout: 4000 })
      .catch(() => {});
    await page.mouse.move(720, 400);
    await page.waitForTimeout(1800);
    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll("body *")) as HTMLElement[]) {
        const cs = getComputedStyle(el);
        const t = el.innerText?.trim() ?? "";
        if (
          (cs.position === "fixed" || el.tagName === "BUTTON") &&
          (t === "Design preview" || t.includes("TanStack"))
        )
          el.style.display = "none";
        if (el.tagName === "BUTTON" && /devtools/i.test(el.getAttribute("aria-label") ?? ""))
          el.style.display = "none";
        if (!["fixed", "absolute"].includes(cs.position)) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.height < 100 && el.querySelectorAll("button").length >= 4)
          el.style.visibility = "hidden";
        if (r.width < 90 && r.height < 90 && r.left < 120 && r.top > 700)
          el.style.visibility = "hidden";
      }
      for (const el of Array.from(document.querySelectorAll("[role=toolbar]")) as HTMLElement[])
        el.style.visibility = "hidden";
    });
    await page.mouse.move(700, 300);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/slide-${String(n).padStart(2, "0")}.png` });
    for (const c of await page.evaluate(svgTextClips)) clips.push({ slide: n, ...c });
    const t = await page.evaluate(renderedTextFaults);
    for (const k of ["offCanvas", "overflow", "overlaps"] as const)
      for (const d of t[k]) dom[k].push({ slide: n, detail: d });
  }
  await browser.close();
  // Diagram labels cut by their SVG's edge (ported from arm C 426bb30f geometry.ts): the slide-model
  // checks cannot see inside a drawn diagram, so the rendered DOM is checked and the faults join
  // checks.json (gates.py reads geom.json in the same summary shape as arm C's).
  writeFileSync(
    `${dirname(file)}/geom.json`,
    `${JSON.stringify(
      {
        source: "rendered DOM (render.ts)",
        summary: {
          overflow: [...new Set(dom.overflow.map((d) => d.slide))],
          overlaps: [...new Set(dom.overlaps.map((d) => d.slide))],
          offCanvas: [...new Set(dom.offCanvas.map((d) => d.slide))],
          clipping: clips.map((c) => `s${c.slide} diagram label "${c.label}" cut ${c.px}px`),
        },
        dom,
        clips,
      },
      null,
      1,
    )}\n`,
  );
  const cf = `${dirname(file)}/checks.json`;
  const domFaults = (["offCanvas", "overflow", "overlaps"] as const).flatMap((k) =>
    dom[k].map((d) => ({ slide: d.slide, detail: `rendered: ${d.detail}` })),
  );
  if (existsSync(cf) && (clips.length || domFaults.length)) {
    const ch = JSON.parse(readFileSync(cf, "utf8")) as {
      slides: { slide: number; faults: string[] }[];
    };
    for (const c of clips)
      ch.slides.find((x) => x.slide === c.slide)?.faults.push(`clipped: ${c.detail}`);
    for (const d of domFaults) ch.slides.find((x) => x.slide === d.slide)?.faults.push(d.detail);
    writeFileSync(cf, `${JSON.stringify(ch, null, 1)}\n`);
  }
  return body.slides.length as number;
}

/**
 * In the page: the rendered slide's text against the slide's own edges, its own box when that box
 * clips, and every other text block. Measured on the glyph line boxes (Range rects), not on the
 * stored element boxes, so only ink that is really cut, off the slide, or overprinted counts.
 */
function renderedTextFaults() {
  const TOL = 2;
  const roots = Array.from(document.querySelectorAll("[data-slide-root]")) as HTMLElement[];
  const root = roots
    .map((r) => ({ r, b: r.getBoundingClientRect() }))
    .filter(({ b }) => b.width > 200)
    .sort((a, z) => z.b.width * z.b.height - a.b.width * a.b.height)[0];
  const out = { offCanvas: [] as string[], overflow: [] as string[], overlaps: [] as string[] };
  if (!root) return out;
  const R = root.b;
  const els = Array.from(root.r.querySelectorAll("[data-element-id]")) as HTMLElement[];
  const blocks: { id: string; text: string; rects: DOMRect[] }[] = [];
  for (const el of els) {
    if (el.closest("svg")) continue;
    const text = (el.innerText ?? "").trim().replace(/\s+/g, " ");
    if (!text) continue;
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const rects = Array.from(rg.getClientRects()).filter((q) => q.width > 1 && q.height > 1);
    const label = text.slice(0, 40);
    if (
      rects.some(
        (q) =>
          q.bottom > R.bottom + TOL ||
          q.right > R.right + TOL ||
          q.top < R.top - TOL ||
          q.left < R.left - TOL,
      )
    )
      out.offCanvas.push(`"${label}" runs off the slide`);
    // Ink cut by a clipping ancestor inside the slide (a fixed box with overflow hidden).
    for (let a = el.parentElement as HTMLElement | null; a && a !== root.r; a = a.parentElement) {
      if (!/hidden|clip/.test(getComputedStyle(a).overflow)) continue;
      const b = a.getBoundingClientRect();
      if (rects.some((q) => q.bottom > b.bottom + TOL || q.right > b.right + TOL)) {
        out.overflow.push(`"${label}" is cut by its box`);
        break;
      }
    }
    blocks.push({ id: el.dataset.elementId ?? "", text: label, rects });
  }
  for (let i = 0; i < blocks.length; i++)
    for (let j = i + 1; j < blocks.length; j++) {
      const A = blocks[i] as (typeof blocks)[number];
      const B = blocks[j] as (typeof blocks)[number];
      const hit = A.rects.some((p) =>
        B.rects.some(
          (q) =>
            Math.max(0, Math.min(p.right, q.right) - Math.max(p.left, q.left)) *
              Math.max(0, Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top)) >
            4 * (R.width / 960) ** 2,
        ),
      );
      if (hit) out.overlaps.push(`"${A.text.slice(0, 25)}" overprints "${B.text.slice(0, 25)}"`);
    }
  return out;
}

/** In the page: each visible SVG <text> against every enclosing SVG viewport that clips (arm C's rule). */
function svgTextClips() {
  const TOL = 2;
  const found: { label: string; px: number; detail: string }[] = [];
  for (const t of Array.from(document.querySelectorAll("svg text"))) {
    const q = t.getBoundingClientRect();
    if (!q.width || !q.height) continue;
    const label = (t.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
    if (!label) continue;
    const ctm = (t as SVGGraphicsElement).getScreenCTM();
    const fs =
      Number.parseFloat(getComputedStyle(t).fontSize) * (ctm ? Math.hypot(ctm.a, ctm.b) : 1);
    // A <text> box includes the font's full ascent and descent; only ink past that slack is cut.
    const vs = 0.3 * fs;
    for (let s = t.parentElement?.closest("svg"); s; s = s.parentElement?.closest("svg") ?? null) {
      if (getComputedStyle(s).overflow === "visible") continue;
      const b = s.getBoundingClientRect();
      const d = Math.max(
        b.left - q.left,
        q.right - b.right,
        b.top - q.top - vs,
        q.bottom - b.bottom - vs,
      );
      if (d > TOL) {
        found.push({
          label,
          px: Math.round(d),
          detail: `${Math.round(d)}px of diagram label "${label}" is cut off by the diagram's edge`,
        });
        break;
      }
    }
  }
  return found;
}

if (import.meta.main) {
  const [file, out] = process.argv.slice(2);
  if (!file) throw new Error("usage: bun lab/bakeoff/render.ts <lesson.json> [outDir]");
  console.log("rendered", await renderLesson(file, out));
}
