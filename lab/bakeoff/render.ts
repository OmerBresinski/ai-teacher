// BAKEOFF shared renderer: lesson.json -> render/slide-NN.png at 1440x810, light theme, through the
// real present view (lab/onecall web dev server, API answered here; photos from the bake-off store).
// Needs: `VITE_API_URL=http://localhost:3936 bun --bun vite --port 4936` in apps/web (BAKEOFF/HARNESS.md).
// Usage: bun lab/bakeoff/render.ts <lesson.json> [outDir]   (outDir defaults to <lesson dir>/render)
import { mkdirSync, readFileSync } from "node:fs";
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
  }
  await browser.close();
  return body.slides.length as number;
}

if (import.meta.main) {
  const [file, out] = process.argv.slice(2);
  if (!file) throw new Error("usage: bun lab/bakeoff/render.ts <lesson.json> [outDir]");
  console.log("rendered", await renderLesson(file, out));
}
