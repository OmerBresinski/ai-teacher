/**
 * Per-slide unlock (ADR 0037, UX ruling 189) @smoke: editing a lesson while it is still being
 * generated. A teacher types into slide 1 while later slides are still writing, and the edit
 * survives the job's later writes and its end. A `bun test` cannot cover it: it needs the real
 * API's merge under the lock, the autosave against a moving row and the editor folding the job's
 * rows in, together. The job's side is played through `POST /__test/job-write`, which writes the
 * way the worker does (`putDocumentAsJob` with its previous copy as the merge base).
 */
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { Lesson } from "@tj/domain/documents";
import { demoWorkspace } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.use({ seed: false });

const proseMirror = (page: Page) => page.locator("[data-slide-frame] .ProseMirror");
const elements = (page: Page) => page.locator("[data-slide-frame] [data-element-id]");

async function dblclickAt(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let i = 0; i < 3; i++) {
    const b = await target.boundingBox();
    if (!b) throw new Error("not on screen");
    await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
    const opened = await proseMirror(page)
      .waitFor({ state: "attached", timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
  }
}

const textOf = (lesson: Lesson, slideId: string) =>
  JSON.stringify(lesson.slides.find((s) => s.id === slideId)?.elements ?? []);

test.describe("editing while the lesson fills @smoke", () => {
  test("slide 1 is editable while slides 2+ are writing; the edit survives the job finishing", async ({
    signedInPage: { page },
  }) => {
    const jobId = "01a06a15-1849-7000-ac6a-c07e27fe3999";
    const water = demoWorkspace(new Date()).find((d) => d.key === "demo-water-cycle");
    if (!water || !("slides" in water.body)) throw new Error("fixture missing");
    const slides = water.body.slides.slice(0, 3);
    const [first, second, third] = slides.map((s) => s.id) as [string, string, string];
    const generation = (states: Record<string, "writing" | "done">) => ({
      jobId,
      stage: "planned" as const,
      startedAt: new Date().toISOString(),
      promptVersions: {},
      usage: { calls: 1, inputTokens: 1, outputTokens: 1, costUsd: 0 },
      findings: [],
      slideStates: states,
    });
    const body = {
      ...water.body,
      slides,
      plan: undefined,
      updatedAt: new Date().toISOString(),
      generation: generation({ [first]: "done", [second]: "writing", [third]: "writing" }),
    };
    const seeded = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
      headers: { origin: E2E_WEB_URL },
      data: { documents: [{ ...water, body, generatingJobId: jobId }] },
    });
    expect(seeded.ok(), await seeded.text()).toBe(true);
    const id = ((await seeded.json()) as { ids: Record<string, string> }).ids["demo-water-cycle"];
    const read = async () => {
      const res = await page.request.get(`${E2E_API_URL}/documents/${id}`, {
        headers: { origin: E2E_WEB_URL },
      });
      return (await res.json()) as {
        document: { body: Lesson; generatingJobId: string | null; updatedAt: string };
      };
    };
    // The job's own copy: the base of its next merged write.
    const jobBase = (await read()).document.body;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/l/${id}`);
    // The editor, not the read-only generating shell: slide 1 is done.
    await expect(page.getByRole("button", { name: "Rename lesson" })).toBeVisible();
    await expect(page.locator("[data-slide-writing]")).toHaveCount(2);

    // A writing slide is selectable but read-only, and says so.
    await page
      .getByRole("option", { name: /^Slide 2,/ })
      .first()
      .click();
    await expect(page.locator("[data-slide-writing-overlay]")).toBeVisible();
    // No toolbar, slide actions or tabs over a slide the job is still writing.
    await expect(page.getByRole("button", { name: "Delete slide" })).toHaveCount(0);
    if (process.env.TEACH_SCREENSHOTS) {
      const shots = path.resolve(import.meta.dirname, "../../../../pr-shots/TEACH-202-b");
      await page.screenshot({ path: path.join(shots, "writing-slide.png") });
    }

    // Slide 1: type into its title.
    await page
      .getByRole("option", { name: /^Slide 1,/ })
      .first()
      .click();
    await expect(page.locator("[data-slide-writing-overlay]")).toHaveCount(0);
    await dblclickAt(page, elements(page).first());
    await expect(proseMirror(page)).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" EDITED-BY-TEACHER");
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => textOf((await read()).document.body, first), { timeout: 15_000 })
      .toContain("EDITED-BY-TEACHER");
    if (process.env.TEACH_SCREENSHOTS) {
      const shots = path.resolve(import.meta.dirname, "../../../../pr-shots/TEACH-202-b");
      await page.screenshot({ path: path.join(shots, "editing-while-writing.png") });
    }

    // The job finishes slides 2 and 3 and rewords slide 1 from its own (older) copy, then ends.
    const reword = (s: Lesson["slides"][number]) =>
      JSON.parse(JSON.stringify(s).replaceAll("The water cycle", "JOB REWORDED")) as typeof s;
    const finished: Lesson = {
      ...jobBase,
      slides: jobBase.slides.map((s) =>
        s.id === first
          ? reword(s)
          : JSON.parse(JSON.stringify(s).replace(/"text":"/, '"text":"JOB DONE ')),
      ),
      generation: generation({ [first]: "done", [second]: "done", [third]: "done" }),
    } as Lesson;
    const write = await page.request.post(`${E2E_API_URL}/__test/job-write`, {
      headers: { origin: E2E_WEB_URL },
      data: { id, jobId, body: finished, base: jobBase, release: true },
    });
    expect(write.ok(), await write.text()).toBe(true);

    // The stored row keeps the teacher's slide 1 and takes the job's slides 2 and 3.
    const after = (await read()).document;
    expect(after.generatingJobId).toBeNull();
    expect(textOf(after.body, first)).toContain("EDITED-BY-TEACHER");
    expect(textOf(after.body, first)).not.toContain("JOB REWORDED");
    expect(textOf(after.body, second)).toContain("JOB DONE");
    // The open editor folds the end in: no writing slides, slide 1 still the teacher's.
    await expect(page.locator("[data-slide-writing]")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator("[data-slide-frame]")).toContainText("EDITED-BY-TEACHER");
    await page
      .getByRole("option", { name: /^Slide 2,/ })
      .first()
      .click();
    await expect(page.locator("[data-slide-frame]")).toContainText("JOB DONE");
    // And a reload shows the same.
    await page.reload();
    await expect(page.locator("[data-slide-frame]")).toContainText("EDITED-BY-TEACHER");
  });
});
