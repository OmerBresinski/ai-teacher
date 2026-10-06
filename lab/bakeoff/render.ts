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
  }
  await browser.close();
  // Diagram labels cut by their SVG's edge (ported from arm C 426bb30f geometry.ts): the slide-model
  // checks cannot see inside a drawn diagram, so the rendered DOM is checked and the faults join
  // checks.json (gates.py reads geom.json in the same summary shape as arm C's).
  writeFileSync(
    `${dirname(file)}/geom.json`,
    `${JSON.stringify({ summary: { overflow: [], overlaps: [], offCanvas: [], clipping: clips.map((c) => `s${c.slide} diagram label "${c.label}" cut ${c.px}px`) }, clips }, null, 1)}\n`,
  );
  const cf = `${dirname(file)}/checks.json`;
  if (existsSync(cf) && clips.length) {
    const ch = JSON.parse(readFileSync(cf, "utf8")) as {
      slides: { slide: number; faults: string[] }[];
    };
    for (const c of clips)
      ch.slides.find((x) => x.slide === c.slide)?.faults.push(`clipped: ${c.detail}`);
    writeFileSync(cf, `${JSON.stringify(ch, null, 1)}\n`);
  }
  return body.slides.length as number;
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
