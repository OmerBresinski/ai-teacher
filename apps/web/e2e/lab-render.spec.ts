/**
 * Quality-lab render (opt-in, never in CI): `LAB_DIR=<eval/results/lab/<label>> … e2e/lab-render.spec.ts`.
 * Seeds the lab's `lesson.json` (and `worksheet.json`) into a fresh e2e user's Workspace, opens
 * the print route without answers, and writes one PNG per slide plus the deck as a PDF into
 * `<LAB_DIR>/shots/` — the same route a teacher's "Save as PDF" uses, so layout faults are the
 * real ones. Then the same with answers, and the worksheet's print route.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

const LAB_DIR = process.env.LAB_DIR ?? "";
test.skip(!LAB_DIR, "Set LAB_DIR to a lab results directory.");
test.use({ viewport: { width: 1200, height: 800 }, seed: false });
test.setTimeout(180_000);

test("renders the lab lesson through the print route", async ({ signedInPage: { page } }) => {
  const lesson = JSON.parse(readFileSync(path.join(LAB_DIR, "lesson.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const worksheetPath = path.join(LAB_DIR, "worksheet.json");
  const worksheet = existsSync(worksheetPath)
    ? (JSON.parse(readFileSync(worksheetPath, "utf8")) as Record<string, unknown>)
    : undefined;
  const shots = path.join(LAB_DIR, "shots");
  mkdirSync(shots, { recursive: true });

  const documents = [
    { key: "lab-lesson", kind: "lesson", body: lesson },
    ...(worksheet ? [{ key: "lab-worksheet", kind: "worksheet", body: worksheet }] : []),
  ];
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents },
  });
  expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };
  const lessonId = ids["lab-lesson"];
  expect(lessonId).toBeTruthy();

  for (const answers of [false, true]) {
    await page.goto(`/l/${lessonId}/print${answers ? "?answers=1" : ""}`);
    await page.waitForSelector("html[data-capture-ready]", { timeout: 60_000 });
    // Let every photograph land (the paint wait already covered decode; this is belt and braces).
    await page.waitForTimeout(500);
    const pages = page.locator("section.td-print-page");
    const count = await pages.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const n = String(i + 1).padStart(2, "0");
      await pages
        .nth(i)
        .screenshot({ path: path.join(shots, `slide-${n}${answers ? "-answers" : ""}.png`) });
    }
    await page.pdf({
      path: path.join(shots, answers ? "deck-answers.pdf" : "deck.pdf"),
      preferCSSPageSize: true,
      printBackground: true,
    });
  }

  const worksheetId = ids["lab-worksheet"];
  if (worksheetId) {
    await page.goto(`/w/${worksheetId}/print`);
    await page
      .waitForSelector("html[data-capture-ready]", { timeout: 60_000 })
      .catch(() => undefined);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(shots, "worksheet.png"), fullPage: true });
    await page.pdf({
      path: path.join(shots, "worksheet.pdf"),
      preferCSSPageSize: true,
      printBackground: true,
    });
  }
});
