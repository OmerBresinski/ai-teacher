// Lab slide renderer, v3 (lab/render-fast, 5 Oct 2026). Drop-in for lab/visual/harness/render.ts v2:
// same CLI, env and output. Seeds each lesson.json into a fresh workspace on a visual stack and
// screenshots every slide in the product's own presenter at 1440x810, light theme, in its PRINTED
// state: teaching builds and worked-example steps revealed, question answers NOT revealed.
//   BUILDS=0     leave a teach slide's builds hidden (default 1: shown)
//   WE_STEPS=0   leave a worked example's steps hidden (default 1: shown)
//   ANSWERS=1    reveal question answers too (default 0: hidden)
//   ONLY=1,3     limit slides; INITIAL=1 captures step 0; STEPS=n (with INITIAL=1) advances n reveals
//   POOL=n       pages rendering in parallel (default 4)
//   RENDER_TIMING=1  per-phase timings on stderr
// v3 against v2: one browser, one sign-in and one seed per lesson; a pool of pages renders slides
// in parallel; fixed sleeps (an 8 s wait for a "Stay in this window" prompt the presenter no longer
// shows, 2.5 s settle, 0.7 s per reveal step, 0.7 s around hiding the chrome) are replaced by
// readiness signals: presenter mounted, status line at the wanted step, fonts loaded, images
// decoded, finite animations finished, network idle and slide geometry stable over two frames.
// Usage: bun render.ts <outDir> <lesson.json>...   Output: <outDir>/<name>/slide-01.png ...
// Library: openRenderer(opts) -> { render(body, dir, slideNumbers), close() } for in-process callers.
import { mkdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const PLAYWRIGHT =
  process.env.PLAYWRIGHT_MODULE ??
  "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/pv-visual/apps/web/node_modules/@playwright/test/index.mjs";
const { chromium } = await import(PLAYWRIGHT);

const on = (k: string, d: boolean) => (process.env[k] === undefined ? d : process.env[k] === "1");
const SHOW = {
  build: on("BUILDS", true),
  worked: on("WE_STEPS", true),
  answer: on("ANSWERS", false),
};
const ANSWER_NAMES = new Set(["Answers", "Row reveal"]);
const TIMING = process.env.RENDER_TIMING === "1";

/** The reveal step a slide is captured at: steps run 1..max over elements, then the answer's own. */
export function printedStep(slide: any): number {
  const kinds = new Map<number, Set<string>>();
  const walk = (els: any[]) => {
    for (const e of els) {
      if (e.revealStep) {
        const kind = ANSWER_NAMES.has(e.name)
          ? "answer"
          : slide.kind === "worked-example"
            ? "worked"
            : "build";
        kinds.set(e.revealStep, (kinds.get(e.revealStep) ?? new Set()).add(kind));
      }
      if (e.type === "group") walk(e.children ?? []);
    }
  };
  walk(slide.elements ?? []);
  const max = Math.max(0, ...kinds.keys());
  for (let k = 1; k <= max; k++) {
    const at = kinds.get(k);
    if (at && [...at].some((x) => !SHOW[x as keyof typeof SHOW])) return k - 1;
  }
  // The question's own answer steps follow the element steps (domain answerRevealSteps).
  return SHOW.answer ? 99 : max;
}

/** Fonts loaded, images decoded, finite animations done, geometry unchanged across two frames. */
async function settle(page: any): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page
    .evaluate(async () => {
      const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
      const deadline = performance.now() + 5000;
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images).map((img) =>
          img.complete ? img.decode().catch(() => {}) : img.decode().catch(() => {}),
        ),
      );
      const finite = () =>
        document.getAnimations().filter((a) => {
          const t = a.effect?.getComputedTiming();
          return a.playState === "running" && t && Number.isFinite(t.endTime as number);
        });
      while (finite().length > 0 && performance.now() < deadline) {
        await Promise.race([
          Promise.all(finite().map((a) => a.finished.catch(() => {}))),
          new Promise((r) => setTimeout(r, 500)),
        ]);
      }
      const shape = () =>
        Array.from(document.querySelectorAll("[data-slide-mode] *"))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return `${r.x | 0},${r.y | 0},${r.width | 0},${r.height | 0}`;
          })
          .join(";");
      let last = "";
      for (let same = 0; same < 2 && performance.now() < deadline; ) {
        await frame();
        const now = shape();
        same = now === last ? same + 1 : 0;
        last = now;
      }
    })
    .catch(() => {});
}

export type RendererOptions = { api: string; web: string; photos: string; pool?: number };

export async function openRenderer(opts: RendererOptions) {
  const { api: API, web: WEB } = opts;
  const pool = Math.max(1, opts.pool ?? 4);
  const browser = await chromium.launch();
  // One context per pool page (cookies copied from the signed-in one): pages sharing a context
  // coordinate as presenter windows of one session and stall each other.
  const newContext = async (storageState?: unknown) => {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 810 },
      colorScheme: "light",
      storageState,
    });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("tj-theme", "light");
      } catch {}
    });
    // Photos placed by fit-drive --images live under stack/storage/<key> with the eval workspace in
    // the key; /files is workspace-scoped in the api, so serve those bytes straight from disk instead.
    await ctx.route("**/files/**", async (route: any) => {
      const key = decodeURIComponent(
        new URL(route.request().url()).pathname.replace(/^.*?\/files\//, ""),
      );
      const f = Bun.file(`${opts.photos}/${key}`);
      if (await f.exists())
        return route.fulfill({ body: Buffer.from(await f.arrayBuffer()), contentType: f.type });
      return route.continue();
    });
    return ctx;
  };
  const ctx = await newContext();
  const email = `visual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const pages: any[] = [await ctx.newPage()];
  const first = pages[0];
  await first.request.post(`${API}/auth/sign-in/magic-link`, {
    headers: { origin: WEB },
    data: { email, callbackURL: `${WEB}/`, errorCallbackURL: `${WEB}/sign-in` },
  });
  const url = (
    await (await first.request.get(`${API}/__test/last-magic-link`, { params: { email } })).json()
  ).url;
  await first.goto(url);
  await first.getByRole("button", { name: "Sign in" }).click();
  await first.waitForURL((u: URL) => !u.pathname.startsWith("/sign-in"), { timeout: 20000 });
  const state = await ctx.storageState();
  while (pages.length < pool) pages.push(await (await newContext(state)).newPage());

  async function shoot(
    page: any,
    id: string,
    n: number,
    slide: any,
    path: string,
  ): Promise<string> {
    const t0 = Date.now();
    const lap: string[] = [];
    const mark = (l: string) => TIMING && lap.push(`${l} ${Date.now() - t0}`);
    await page.goto(`${WEB}/l/${id}/present?slide=${n}`);
    // Presenter mounted. Older presenters asked "Stay in this window" first: answer it only if shown.
    const stay = page.getByRole("button", { name: "Stay in this window" });
    await page
      .locator('[data-slide-mode="present"]')
      .or(stay)
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => {});
    if (await stay.isVisible().catch(() => false)) await stay.click().catch(() => {});
    mark("mounted");
    await page.mouse.move(720, 400);
    let status = "";
    const statusLoc = page.locator("[role=status][aria-live=polite]").first();
    if (process.env.INITIAL) {
      for (let s = 0; s < Number(process.env.STEPS ?? 0); s++) {
        await settle(page);
        await page.keyboard.press("ArrowRight");
      }
    } else {
      // Step to the slide's printed state: the last step before the first hidden reveal kind.
      const want = printedStep(slide);
      await statusLoc.waitFor({ state: "attached", timeout: 8000 }).catch(() => {});
      for (let guard = 0; guard < 40; guard++) {
        const t = (await statusLoc.textContent({ timeout: 2000 }).catch(() => "")) ?? "";
        const m = t.match(/step (\d+) of (\d+)/);
        if (!m || Number(m[1]) - 1 >= Math.min(want, Number(m[2]) - 1)) break;
        await page.keyboard.press("ArrowRight");
        await page
          .waitForFunction(
            (prev: string) =>
              document.querySelector("[role=status][aria-live=polite]")?.textContent !== prev,
            t,
            { timeout: 3000 },
          )
          .catch(() => {});
      }
      status = (await statusLoc.textContent({ timeout: 2000 }).catch(() => "")) ?? "";
      if (!status.startsWith(`Slide ${n} of`))
        console.error(`s${n}: status "${status}" after stepping`);
    }
    mark("stepped");
    await settle(page);
    mark("settled");
    // Hide dev-only overlays and the cursor-summoned presenter chrome so only the slide shows.
    await page.mouse.move(700, 300);
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
    await settle(page);
    mark("chrome");
    await page.screenshot({ path });
    mark("shot");
    if (TIMING) console.error(`T s${n}: ${lap.join(", ")}`);
    return status;
  }

  return {
    /** Renders the given 1-based slide numbers (all when omitted) to <dir>/slide-NN.png, NN counting rendered slides. */
    async render(
      body: any,
      dir: string,
      only?: number[] | null,
    ): Promise<{ files: Map<number, string>; steps: string[] }> {
      body = { ...body, updatedAt: new Date().toISOString() };
      if (body.plan && !body.plan.jobId) body.plan = { ...body.plan, jobId: "visual-render" };
      const seeded = await first.request.post(`${API}/__test/seed-library`, {
        data: { documents: [{ key: "l", kind: "lesson", body }] },
      });
      const res = await seeded.json();
      if (!res.ids) throw new Error(`seed failed: ${JSON.stringify(res).slice(0, 600)}`);
      const id = res.ids.l;
      mkdirSync(dir, { recursive: true });
      const wanted = body.slides
        .map((_: unknown, i: number) => i + 1)
        .filter((n: number) => !only || only.includes(n));
      const files = new Map<number, string>();
      const steps = new Map<number, string>();
      let next = 0;
      await Promise.all(
        pages.map(async (page) => {
          while (next < wanted.length) {
            const k = next++;
            const n = wanted[k];
            const path = `${dir}/slide-${String(k + 1).padStart(2, "0")}.png`;
            try {
              const t = await shoot(page, id, n, body.slides[n - 1], path);
              files.set(n, path);
              steps.set(n, `s${n}: ${t.replace(/^Slide \d+ of \d+,? ?/, "") || "no steps"}`);
            } catch (e) {
              console.error(`s${n}: ${e instanceof Error ? e.message : e}`);
            }
          }
        }),
      );
      return {
        files,
        steps: wanted.filter((n: number) => steps.has(n)).map((n: number) => steps.get(n)!),
      };
    },
    close: () => browser.close(),
  };
}

if (import.meta.main) {
  const [out, ...files] = process.argv.slice(2);
  if (!out || files.length === 0) {
    console.error("usage: bun render.ts <outDir> <lesson.json>...");
    process.exit(2);
  }
  const t0 = Date.now();
  const r = await openRenderer({
    api: process.env.VISUAL_API ?? "http://localhost:3641",
    web: process.env.VISUAL_WEB ?? "http://localhost:4641",
    photos:
      process.env.VISUAL_PHOTOS ??
      "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/visual/stack/storage",
    pool: Number(process.env.POOL ?? 4),
  });
  if (TIMING) console.error(`T open+signin ${Date.now() - t0}`);
  const only = process.env.ONLY ? process.env.ONLY.split(",").map(Number) : null;
  for (const f of files) {
    const body = JSON.parse(readFileSync(f, "utf8"));
    const name = basename(f).replace(/\.lesson\.json$|\.json$/, "");
    const dir = `${out}/${name}`;
    try {
      const { files: done, steps } = await r.render(body, dir, only);
      console.log(
        `${name}: ${done.size} slides -> ${dir}${steps.length && !process.env.INITIAL ? `\n  ${steps.join("; ")}` : ""}`,
      );
    } catch (e) {
      console.error(f, e instanceof Error ? e.message : e);
    }
  }
  await r.close();
  if (TIMING) console.error(`T total ${Date.now() - t0}`);
}
