/**
 * One teacher, one lesson, through the real web app: brief → objectives → go → wait → edit →
 * reload → Export → PDF. Every time is taken from what the page shows, from the moment of the
 * last click that starts generation ("go").
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { Stack } from "./stack";

export type Brief = {
  id: string;
  keyStage: string;
  yearGroup: string;
  topic: string;
  slideCount: number;
};
export type Who = "guest" | "signed-in";
// biome-ignore lint/suspicious/noExplicitAny: the saved lesson is read loosely on purpose
export type Doc = any;

export type TeacherRun = {
  brief: string;
  who: Who;
  mode: "paid" | "cheap";
  lessonId?: string;
  goAt?: string;
  yearSeeded: boolean;
  /** Seconds from go; null when it never happened before the timeout. */
  times: {
    objectivesShownS: number | null;
    firstVisibleSlideS: number | null;
    firstEditableS: number | null;
    allEditableS: number | null;
    picturesInS: number | null;
    doneS: number | null;
  };
  edits: { marker: string; slide: number; typedAtS: number | null; kept: boolean | null }[];
  saveStateAfterEdits: string | null;
  failedWrites: string[];
  networkErrors: string[];
  consoleErrors: string[];
  exportPdf: { ok: boolean; url: string | null; pages: number; note: string };
  screenshots: string[];
  doc: Doc | null;
  error?: string;
};

const MAGIC_CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX";
const UI_YEARS = [3, 4, 5, 6, 7, 8, 9, 10, 11].map((y) => `Year ${y}`);

const rail = (page: Page) => page.getByRole("listbox", { name: "Slides" }).getByRole("option");
const proseMirror = (page: Page) => page.locator("[data-slide-frame] .ProseMirror");

/** Types `marker` at the end of the first text box of slide `i`; true only if it shows up. */
async function typeInto(page: Page, i: number, marker: string): Promise<boolean> {
  try {
    const options = rail(page);
    const n = await options.count();
    if (n === 0) return false;
    await options.nth(i < 0 ? n - 1 : Math.min(i, n - 1)).click({ timeout: 2_000 });
    await page.waitForTimeout(250);
    const text = page.locator('[data-slide-mode="edit"] [data-element-type="text"]').first();
    if (!(await text.isVisible())) return false;
    const b = await text.boundingBox();
    if (!b) return false;
    await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
    const opened = await proseMirror(page)
      .waitFor({ state: "attached", timeout: 1_500 })
      .then(() => true)
      .catch(() => false);
    if (!opened) return false;
    // Keys pressed before the editor holds focus are lost (or land elsewhere): wait for focus.
    let focused = false;
    for (let k = 0; k < 15 && !focused; k++) {
      focused = await proseMirror(page)
        .first()
        .evaluate((el) => el === document.activeElement || el.contains(document.activeElement))
        .catch(() => false);
      if (!focused) await page.waitForTimeout(100);
    }
    if (!focused) {
      await page.keyboard.press("Escape");
      return false;
    }
    await page.waitForTimeout(150);
    await page.keyboard.press("End");
    await page.keyboard.type(` ${marker}`);
    let typed = false;
    for (let k = 0; k < 10 && !typed; k++) {
      typed = ((await proseMirror(page).textContent()) ?? "").includes(marker);
      if (!typed) await page.waitForTimeout(100);
    }
    await page.keyboard.press("Escape");
    return typed;
  } catch {
    return false;
  }
}

async function readDoc(page: Page, api: string, id: string): Promise<Doc | null> {
  try {
    const res = await page.request.get(`${api}/documents/${id}`);
    if (!res.ok()) return null;
    const j = await res.json();
    return j.document?.body ?? j.document ?? null;
  } catch {
    return null;
  }
}

/**
 * True while a job still holds the lesson's lock (ADR 0037): the editor can be open and editable
 * before then, so "editable" and "done" are read from the row, not from which view is on screen.
 */
async function jobRunning(page: Page, api: string, id: string): Promise<boolean | null> {
  try {
    const res = await page.request.get(`${api}/documents/${id}`);
    if (!res.ok()) return null;
    const j = await res.json();
    return (j.document?.generatingJobId ?? null) !== null;
  } catch {
    return null;
  }
}

/** The first slide in the rail not marked as still being written, or -1. */
async function firstWritten(page: Page): Promise<number> {
  const options = rail(page);
  const n = await options.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const writing = await options
      .nth(i)
      .locator("[data-slide-writing]")
      .count()
      .catch(() => 0);
    if (writing === 0) return i;
  }
  return -1;
}

const imageSrcs = (doc: Doc | null): string =>
  JSON.stringify(
    (doc?.slides ?? []).map((s: Doc) =>
      (s.elements ?? []).filter((e: Doc) => e.type === "image").map((e: Doc) => e.src),
    ),
  );

async function signIn(page: Page, stack: Stack): Promise<void> {
  const email = `teacher-path-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await fetch(`${stack.api}/auth/sign-in/magic-link`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: stack.web,
      "x-captcha-response": MAGIC_CAPTCHA,
    },
    body: JSON.stringify({
      email,
      callbackURL: `${stack.web}/lessons/new`,
      errorCallbackURL: `${stack.web}/sign-in`,
    }),
  });
  if (!res.ok) throw new Error(`magic link request ${res.status}: ${await res.text()}`);
  const link = await fetch(
    `${stack.api}/__test/last-magic-link?email=${encodeURIComponent(email)}`,
  ).then((r) => r.json() as Promise<{ url: string }>);
  await page.goto(link.url);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30_000 });
}

function watch(page: Page, run: TeacherRun, api: string, ignore: string[]) {
  const apiOrigin = new URL(api).origin;
  page.on("console", (m) => {
    // "Failed to load resource" repeats a network error, which is recorded with its URL below.
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) {
      run.consoleErrors.push(m.text().slice(0, 300));
    }
  });
  page.on("pageerror", (e) => run.consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on("requestfailed", (r) => {
    const failure = r.failure()?.errorText ?? "failed";
    // Navigations away abort in-flight requests; those are not the product failing.
    if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(failure)) return;
    const line = `${r.method()} ${new URL(r.url()).pathname} ${failure}`;
    run.networkErrors.push(line);
    if (r.method() !== "GET") run.failedWrites.push(line);
  });
  page.on("response", (r) => {
    if (r.status() < 400) return;
    const u = new URL(r.url());
    const line = `${r.request().method()} ${u.pathname} ${r.status()}`;
    const short = line.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id");
    if (ignore.includes(short)) return;
    run.networkErrors.push(line);
    if (u.origin === apiOrigin && r.request().method() !== "GET") run.failedWrites.push(line);
  });
}

function emptyRun(brief: Brief, who: Who, mode: "paid" | "cheap"): TeacherRun {
  return {
    brief: brief.id,
    who,
    mode,
    yearSeeded: false,
    times: {
      objectivesShownS: null,
      firstVisibleSlideS: null,
      firstEditableS: null,
      allEditableS: null,
      picturesInS: null,
      doneS: null,
    },
    edits: [],
    saveStateAfterEdits: null,
    failedWrites: [],
    networkErrors: [],
    consoleErrors: [],
    exportPdf: { ok: false, url: null, pages: 0, note: "not reached" },
    screenshots: [],
    doc: null,
  };
}

async function newContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    deviceScaleFactor: 1,
  });
}

/** Brief → objectives → go, as a teacher; returns the go timestamp (ms). */
async function startLesson(page: Page, brief: Brief, run: TeacherRun, web: string) {
  const t0 = Date.now();
  await page.goto(`${web}/lessons/new`);
  await page.getByRole("textbox", { name: "Topic", exact: true }).fill(brief.topic);
  if (UI_YEARS.includes(brief.yearGroup)) {
    await page.getByRole("combobox", { name: "Year group" }).click();
    await page.getByRole("option", { name: brief.yearGroup, exact: true }).click();
  }
  await page.getByRole("button", { name: "Next" }).click();
  await page
    .getByRole("heading", { name: "Learning objectives" })
    .waitFor({ state: "visible", timeout: 180_000 });
  run.times.objectivesShownS = (Date.now() - t0) / 1000;
  await page.getByRole("combobox", { name: "Slides" }).click();
  // The label may say more ("10 slides, including the title"): match the number at the start.
  await page.getByRole("option", { name: new RegExp(`^${brief.slideCount} slides\\b`) }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  let go = Date.now();
  const sheet = page.getByRole("button", { name: "Just the slides" });
  if (await sheet.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await sheet.click();
    go = Date.now();
  }
  return go;
}

/** Waits for generation, measuring every milestone from the page itself. */
async function waitForLesson(
  page: Page,
  stack: Stack,
  run: TeacherRun,
  go: number,
  timeoutS: number,
) {
  const s = () => (Date.now() - go) / 1000;
  const until = go + timeoutS * 1000;
  let lastSrcs = "";
  let lastSrcChange: number | null = null;
  let lastRailCount = 0;
  let railSettledAt = 0;
  let sawShell = false;
  let landedAt = 0;
  let lastDocPoll = 0;
  while (Date.now() < until) {
    const m = /\/l\/([0-9a-f-]{36})/.exec(new URL(page.url()).pathname);
    if (m) {
      run.lessonId = m[1];
      landedAt ||= Date.now();
    }
    if (run.times.firstVisibleSlideS === null) {
      const visible = await page
        .locator("[data-slide-root]")
        .first()
        .isVisible()
        .catch(() => false);
      if (visible) run.times.firstVisibleSlideS = s();
    }
    const n = await rail(page)
      .count()
      .catch(() => 0);
    if (n !== lastRailCount) {
      lastRailCount = n;
      railSettledAt = s();
    }
    // Editable means a slide takes typing while the job still runs (ruling 189); once the job has
    // ended, the first edit is the after-done check, not this one.
    const running = run.lessonId ? await jobRunning(page, stack.api, run.lessonId) : null;
    const first = run.times.firstEditableS === null && n > 0 ? await firstWritten(page) : -1;
    if (run.times.firstEditableS === null && running !== false && first >= 0) {
      if (await typeInto(page, first, "TPFIRST")) {
        run.times.firstEditableS = s();
        run.edits.push({ marker: "TPFIRST", slide: first + 1, typedAtS: s(), kept: null });
      }
    } else if (run.times.allEditableS === null && run.times.firstEditableS !== null && n > 1) {
      if (await typeInto(page, -1, "TPLAST")) {
        // Counted only once the deck had stopped growing: a later slide may not have existed yet.
        run.times.allEditableS = Math.max(s(), railSettledAt);
        run.edits.push({ marker: "TPLAST", slide: n, typedAtS: s(), kept: null });
      }
    }
    if (run.lessonId && Date.now() - lastDocPoll > 2_500) {
      lastDocPoll = Date.now();
      const doc = await readDoc(page, stack.api, run.lessonId);
      const srcs = imageSrcs(doc);
      if (doc && srcs !== lastSrcs) {
        lastSrcs = srcs;
        lastSrcChange = s();
      }
    }
    const shell = await page
      .getByTestId("generating-shell")
      .count()
      .catch(() => 0);
    if (shell > 0) sawShell = true;
    const editor = await page
      .getByRole("button", { name: "Rename lesson" })
      .isVisible()
      .catch(() => false);
    if (
      run.lessonId &&
      shell === 0 &&
      // A guest's finished lesson opens read-only (TEACH-245), with no Rename control.
      (editor || run.who === "guest") &&
      running === false &&
      (sawShell || (landedAt && Date.now() - landedAt > 8_000))
    ) {
      run.times.doneS = s();
      if (run.times.allEditableS === null && n > 1 && (await typeInto(page, -1, "TPLAST"))) {
        run.times.allEditableS = s();
        run.edits.push({ marker: "TPLAST", slide: n, typedAtS: s(), kept: null });
      }
      break;
    }
    await page.waitForTimeout(400);
  }
  // Pictures keep arriving after the lock is released on some pipelines: watch the saved
  // document for a further 30 s of quiet before calling the pictures in.
  if (run.lessonId && run.times.doneS !== null) {
    const quietUntil = Date.now() + 30_000;
    while (Date.now() < quietUntil && Date.now() < until) {
      const srcs = imageSrcs(await readDoc(page, stack.api, run.lessonId));
      if (srcs !== lastSrcs) {
        lastSrcs = srcs;
        lastSrcChange = s();
      }
      await page.waitForTimeout(3_000);
    }
    run.times.picturesInS = lastSrcChange;
  }
}

async function afterDone(
  page: Page,
  context: BrowserContext,
  stack: Stack,
  run: TeacherRun,
  outDir: string,
) {
  if (!run.lessonId) return;
  // An edit a teacher makes once the lesson is finished.
  const n = await rail(page).count();
  const since = (ms: number) => (ms - Date.parse(run.goAt ?? new Date().toISOString())) / 1000;
  if (run.times.allEditableS === null && n > 1 && (await typeInto(page, -1, "TPLAST"))) {
    run.times.allEditableS = since(Date.now());
    run.edits.push({ marker: "TPLAST", slide: n, typedAtS: run.times.allEditableS, kept: null });
  }
  // An edit a teacher makes once the lesson is finished, on the first teaching slide that takes it.
  for (const slide of [2, 3, 4, 1].filter((i) => i < n - 1)) {
    if (await typeInto(page, slide, "TPDONE")) {
      run.edits.push({
        marker: "TPDONE",
        slide: slide + 1,
        typedAtS: since(Date.now()),
        kept: null,
      });
      break;
    }
  }
  const save = page.locator("[data-save-state]").first();
  for (let k = 0; k < 40; k++) {
    run.saveStateAfterEdits = await save.getAttribute("data-save-state").catch(() => null);
    if (run.saveStateAfterEdits !== "unsaved" && run.saveStateAfterEdits !== "saving") break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1_500);

  // Screenshots of every slide, light theme, 1440 wide.
  const shots = join(outDir, "slides");
  mkdirSync(shots, { recursive: true });
  for (let i = 0; i < n; i++) {
    await rail(page).nth(i).click();
    await page.waitForTimeout(500);
    const file = join(shots, `slide-${String(i + 1).padStart(2, "0")}.png`);
    await page.screenshot({ path: file });
    run.screenshots.push(file);
  }

  // Reload: is every edit still there?
  await page.reload();
  await page
    .getByRole("button", { name: "Rename lesson" })
    .waitFor({ timeout: 30_000 })
    .catch(() => {});
  run.doc = await readDoc(page, stack.api, run.lessonId);
  markKept(run.edits, run.doc);

  // Export → PDF: the print view must render the lesson.
  try {
    await page.getByRole("button", { name: "Export", exact: true }).click({ timeout: 10_000 });
    const dialog = page.getByRole("dialog", { name: "Export" });
    await dialog.waitFor({ timeout: 10_000 });
    const popup = context.waitForEvent("page", { timeout: 15_000 }).catch(() => null);
    await dialog.getByRole("button", { name: "Export PDF" }).click();
    const target = (await popup) ?? page;
    await target.waitForLoadState("domcontentloaded").catch(() => {});
    await target.waitForTimeout(1_000);
    run.exportPdf.url = target.url();
    if (new URL(target.url()).pathname.startsWith("/sign-in")) {
      run.exportPdf.note = "sent to /sign-in instead of the print view";
    } else {
      const pages = target.locator(".td-print .td-print-page, .td-print .td-handout-page");
      await pages.first().waitFor({ timeout: 60_000 });
      await target
        .locator('html[data-capture-ready="true"]')
        .waitFor({ timeout: 60_000 })
        .catch(() => {});
      run.exportPdf.pages = await pages.count();
      const slides = run.doc?.slides?.length ?? 0;
      run.exportPdf.ok = run.exportPdf.pages >= slides && slides > 0;
      run.exportPdf.note = `${run.exportPdf.pages} print pages for ${slides} slides`;
      await target.screenshot({ path: join(outDir, "export-pdf.png") });
    }
  } catch (e) {
    run.exportPdf.note = `failed: ${String(e).split("\n")[0]}`;
  }
}

/**
 * An edit counts as saved only if the document read back from the api after the reload holds it.
 * What the page shows is never evidence: an editor can show text the server refused.
 */
export function markKept(edits: TeacherRun["edits"], saved: Doc | null) {
  const body = saved ? JSON.stringify(saved) : "";
  for (const e of edits) if (e.typedAtS !== null) e.kept = body.includes(e.marker);
}

/** Paid mode: the whole path, generating for real. */
export async function teacherPath(opts: {
  browser: Browser;
  stack: Stack;
  brief: Brief;
  who: Who;
  outDir: string;
  timeoutS: number;
  ignoreNetwork: string[];
}): Promise<TeacherRun> {
  const { browser, stack, brief, who, outDir } = opts;
  const run = emptyRun(brief, who, "paid");
  mkdirSync(outDir, { recursive: true });
  const context = await newContext(browser);
  if (!UI_YEARS.includes(brief.yearGroup)) {
    // The brief offers Years 3 to 11 only; another year is seeded as the remembered class.
    run.yearSeeded = true;
    await context.addInitScript((year: string) => {
      localStorage.setItem(
        "tj:brief:last-class",
        JSON.stringify({ subject: "", subjectOther: "", yearGroup: year, themeId: "" }),
      );
    }, brief.yearGroup);
  }
  const page = await context.newPage();
  watch(page, run, stack.api, opts.ignoreNetwork);
  try {
    if (who === "signed-in") await signIn(page, stack);
    const go = await startLesson(page, brief, run, stack.web);
    run.goAt = new Date(go).toISOString();
    await waitForLesson(page, stack, run, go, opts.timeoutS);
    await afterDone(page, context, stack, run, outDir);
  } catch (e) {
    run.error = String(e).split("\n").slice(0, 3).join(" ");
    await page.screenshot({ path: join(outDir, "error.png") }).catch(() => {});
  } finally {
    await context.close();
  }
  return run;
}

/** Saves the finished lesson and its stored pictures, for cheap mode to replay. */
export function record(run: TeacherRun, storageRoot: string, dir: string) {
  if (!run.doc) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "lesson.json"), JSON.stringify(run.doc, null, 2));
  for (const key of fileKeys(run.doc)) {
    const from = join(storageRoot, key);
    if (!existsSync(from)) continue;
    const to = join(dir, "files", key);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
}

function fileKeys(doc: Doc): string[] {
  const keys = new Set<string>();
  for (const m of JSON.stringify(doc).matchAll(/"\/files\/([^"?]+)"/g)) if (m[1]) keys.add(m[1]);
  return [...keys];
}

/** Cheap mode: a recorded lesson, seeded for a signed-in teacher; UI checks only. */
export async function replayPath(opts: {
  browser: Browser;
  stack: Stack;
  brief: Brief;
  recording: string;
  outDir: string;
  ignoreNetwork: string[];
}): Promise<TeacherRun> {
  const { browser, stack, brief, outDir } = opts;
  const run = emptyRun(brief, "signed-in", "cheap");
  mkdirSync(outDir, { recursive: true });
  const context = await newContext(browser);
  const page = await context.newPage();
  watch(page, run, stack.api, opts.ignoreNetwork);
  try {
    await signIn(page, stack);
    const me = await (await page.request.get(`${stack.api}/me`)).json();
    const ws: string = me.workspaceId;
    let text = readFileSync(join(opts.recording, "lesson.json"), "utf8");
    const old = /"\/files\/([0-9a-f-]{36})\//.exec(text)?.[1];
    if (old) {
      for (const key of fileKeys(JSON.parse(text))) {
        const from = join(opts.recording, "files", key);
        if (!existsSync(from)) continue;
        const to = join(stack.storageRoot, key.replace(old, ws));
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      }
      text = text.replaceAll(`/files/${old}/`, `/files/${ws}/`);
    }
    const body = JSON.parse(text);
    body.updatedAt = new Date().toISOString();
    // Replayed as a lesson still filling (ADR 0037): the first half of the slides done, the rest
    // still being written, under a job lock. Editable then means typing into a done slide while
    // the lock is held, and a writing slide must refuse it.
    const jobId = crypto.randomUUID();
    const ids: string[] = (body.slides ?? []).map((x: { id: string }) => x.id);
    const half = Math.max(1, Math.ceil(ids.length / 2));
    const stateOf = (done: boolean) =>
      Object.fromEntries(ids.map((id, i) => [id, done || i < half ? "done" : "writing"]));
    const generation = body.generation ?? {
      stage: "planned",
      startedAt: new Date().toISOString(),
      promptVersions: {},
      usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      findings: [],
    };
    const filling = { ...body, generation: { ...generation, jobId, slideStates: stateOf(false) } };
    const res = await page.request.post(`${stack.api}/__test/seed-library`, {
      headers: { origin: stack.web },
      data: {
        documents: [{ key: "recorded", kind: "lesson", body: filling, generatingJobId: jobId }],
      },
    });
    if (!res.ok()) throw new Error(`seed ${res.status()}: ${await res.text()}`);
    run.lessonId = (await res.json()).ids.recorded;
    const go = Date.now();
    run.goAt = new Date(go).toISOString();
    await page.goto(`${stack.web}/l/${run.lessonId}`);
    await page.locator("[data-slide-root]").first().waitFor({ timeout: 30_000 });
    run.times.firstVisibleSlideS = (Date.now() - go) / 1000;
    await page.getByRole("button", { name: "Rename lesson" }).waitFor({ timeout: 30_000 });
    const first = await firstWritten(page);
    if (
      first >= 0 &&
      (await jobRunning(page, stack.api, run.lessonId)) === true &&
      (await typeInto(page, first, "TPFIRST"))
    ) {
      run.times.firstEditableS = (Date.now() - go) / 1000;
      run.edits.push({
        marker: "TPFIRST",
        slide: first + 1,
        typedAtS: run.times.firstEditableS,
        kept: null,
      });
    }
    // A slide still being written takes no typing.
    if (ids.length > half && (await typeInto(page, -1, "TPWRITING"))) {
      throw new Error("a slide still being written accepted typing");
    }
    // The job ends: the recorded slides, all done, written as the worker would, lock released.
    const base = (await readDoc(page, stack.api, run.lessonId)) as unknown;
    const finish = await page.request.post(`${stack.api}/__test/job-write`, {
      headers: { origin: stack.web },
      data: {
        id: run.lessonId,
        jobId,
        base: filling,
        body: {
          ...filling,
          id: (base as { id?: string } | null)?.id ?? filling.id,
          generation: { ...filling.generation, slideStates: stateOf(true) },
        },
        release: true,
      },
    });
    if (!finish.ok()) throw new Error(`job-write ${finish.status()}: ${await finish.text()}`);
    await page
      .locator("[data-slide-writing]")
      .first()
      .waitFor({ state: "detached", timeout: 30_000 });
    run.times.doneS = (Date.now() - go) / 1000;
    await afterDone(page, context, stack, run, outDir);
  } catch (e) {
    run.error = String(e).split("\n").slice(0, 3).join(" ");
  } finally {
    await context.close();
  }
  return run;
}
