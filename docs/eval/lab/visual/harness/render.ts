// Visual harness renderer. Seeds each lesson.json into a fresh workspace on the visual stack
// (harness/stack.sh: api 3641, web 4641, pv-visual code) and screenshots every slide in the
// product's own presenter at 1440x810, light theme, reveal step 0 (what the class sees before any
// answer is revealed). Placed photos are served by the stack's api from stack/storage (/files/<key>).
// Usage: bun harness/render.ts <outDir> <lesson.json>...   (env ONLY=1,3 limits slides; STEPS=n advances n reveals)
// Output: <outDir>/<name>/slide-01.png ...
import { mkdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { chromium } from "@playwright/test";

const API = process.env.VISUAL_API ?? "http://localhost:3641";
const WEB = process.env.VISUAL_WEB ?? "http://localhost:4641";
const [out, ...files] = process.argv.slice(2);
if (!out || files.length === 0) {
  console.error("usage: bun harness/render.ts <outDir> <lesson.json>...");
  process.exit(2);
}
const email = `visual-${Date.now()}@example.com`;
const link = async (request: any, callback: string) => {
  await request.post(`${API}/auth/sign-in/magic-link`, {
    headers: { origin: WEB },
    data: { email, callbackURL: `${WEB}${callback}`, errorCallbackURL: `${WEB}/sign-in` },
  });
  return (await (await request.get(`${API}/__test/last-magic-link`, { params: { email } })).json())
    .url;
};
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
// Photos placed by fit-drive --images live under stack/storage/<key> with the eval workspace in the
// key; /files is workspace-scoped in the api, so serve those bytes straight from disk instead.
const PHOTOS = process.env.VISUAL_PHOTOS ?? new URL("../stack/storage", import.meta.url).pathname;
await page.route("**/files/**", async (route: any) => {
  const key = decodeURIComponent(
    new URL(route.request().url()).pathname.replace(/^.*?\/files\//, ""),
  );
  const f = Bun.file(`${PHOTOS}/${key}`);
  if (await f.exists())
    return route.fulfill({ body: Buffer.from(await f.arrayBuffer()), contentType: f.type });
  return route.continue();
});
await page.goto(await link(page.request, "/"));
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL((u: URL) => !u.pathname.startsWith("/sign-in"), { timeout: 20000 });
const only = process.env.ONLY ? process.env.ONLY.split(",").map(Number) : null;
for (const f of files) {
  const body = JSON.parse(readFileSync(f, "utf8"));
  body.updatedAt = new Date().toISOString();
  if (body.plan && !body.plan.jobId) body.plan = { ...body.plan, jobId: "visual-render" };
  const seeded = await page.request.post(`${API}/__test/seed-library`, {
    data: { documents: [{ key: "l", kind: "lesson", body }] },
  });
  const res = await seeded.json();
  if (!res.ids) {
    console.error(f, JSON.stringify(res).slice(0, 600));
    continue;
  }
  const id = res.ids.l;
  const name = basename(f).replace(/\.lesson\.json$|\.json$/, "");
  const dir = `${out}/${name}`;
  mkdirSync(dir, { recursive: true });
  let k = 0;
  for (let n = 1; n <= body.slides.length; n++) {
    if (only && !only.includes(n)) continue;
    await page.goto(`${WEB}/l/${id}/present?slide=${n}`);
    await page
      .getByRole("button", { name: "Stay in this window" })
      .click({ timeout: 8000 })
      .catch(() => {});
    await page.mouse.move(720, 400);
    for (let s = 0; s < Number(process.env.STEPS ?? 0); s++) {
      await page.waitForTimeout(700);
      await page.keyboard.press("ArrowRight");
    }
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2500);
    // Hide dev-only overlays and the cursor-summoned presenter chrome so only the slide shows.
    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll("body *")) as HTMLElement[]) {
        const t = el.innerText?.trim() ?? "";
        const pos = getComputedStyle(el).position;
        if (
          (pos === "fixed" || el.tagName === "BUTTON") &&
          (t === "Design preview" || t.includes("TanStack"))
        )
          el.style.display = "none";
        if (el.tagName === "BUTTON" && /devtools/i.test(el.getAttribute("aria-label") ?? ""))
          el.style.display = "none";
      }
    });
    // Park the pointer mid-slide, then hide the presenter's floating control bar (slide counter
    // "n / N", Reveal/Answer, pens): the positioned ancestor of the counter text.
    await page.mouse.move(700, 300);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      // A short positioned bar holding several buttons is the control bar, never slide content.
      for (const el of Array.from(document.querySelectorAll("body *")) as HTMLElement[]) {
        const cs = getComputedStyle(el);
        if (!["fixed", "absolute"].includes(cs.position)) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.height < 100 && el.querySelectorAll("button").length >= 4)
          el.style.visibility = "hidden";
      }
      for (const el of Array.from(document.querySelectorAll("[role=toolbar]")) as HTMLElement[])
        el.style.visibility = "hidden";
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/slide-${String(++k).padStart(2, "0")}.png` });
  }
  console.log(`${name}: ${k} slides -> ${dir}`);
}
await browser.close();
