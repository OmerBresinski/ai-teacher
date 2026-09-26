import type { Locator, Page } from "@playwright/test";
import { type Lesson, plainTextOf, type Slide, type SlideElement } from "@tj/domain/documents";
import { generatedLesson, generatedText } from "@tj/domain/documents/fixtures";
import { E2E_API_URL, E2E_WEB_URL, expect, type SeededPaths, test } from "./fixtures";

/*
 * In-place text editing on `/l/$lessonId` (TEACH-104): rows 1, 2, 7 and 9 of the acceptance table
 * with a real caret — double-click, type, Escape — where happy-dom cannot follow.
 */

const EDITOR = (paths: SeededPaths) => paths.lesson("demo-water-cycle");
const elements = (page: Page) => page.locator("[data-slide-frame] [data-element-id]");
const proseMirror = (page: Page) => page.locator("[data-slide-frame] .ProseMirror");
const stage = (page: Page) => page.locator("[data-selection-layer]");

/**
 * The element's box once it has settled. `toBeVisible` retries but `boundingBox()` does not, and on
 * a loaded CI runner the canvas is still being scaled (`SlideScaler` rewrites the scale after its
 * first layout) or the static `td-rt` is being remounted when the first read lands — so the box
 * is polled until two consecutive reads agree (TEACH-172).
 */
type Box = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;
const sameBox = (a: Box | null, b: Box | null) =>
  a !== null &&
  b !== null &&
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height;

async function box(locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible();
  const reads: (Box | null)[] = [];
  await expect
    .poll(
      async () => {
        reads.push(await locator.boundingBox());
        return (
          reads.length >= 2 &&
          sameBox(reads[reads.length - 1] ?? null, reads[reads.length - 2] ?? null)
        );
      },
      { message: "element box did not settle" },
    )
    .toBe(true);
  const last = reads[reads.length - 1];
  if (!last) throw new Error("not on screen");
  return last;
}

/** The rendered text block inside an element: the `td-rt` node, static or editable. */
const richText = (el: Locator) => el.locator(".td-rt").first();

/**
 * Elements sit under the transform layer's pointer catcher, so Playwright's own `dblclick()` waits
 * forever for them to "receive" the event; double-click where the element is, as a hand does.
 */
async function dblclickAt(page: Page, target: Locator, opens: Locator = proseMirror(page)) {
  const b = await box(target);
  await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
  // The canvas can still move under the pointer between the two clicks on a slow runner; when the
  // editor `opens` did not appear, the box is re-read and the double-click made once more
  // (TEACH-172).
  const opened = await opens
    .waitFor({ state: "attached", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    const again = await box(target);
    await page.mouse.dblclick(again.x + again.width / 2, again.y + again.height / 2);
  }
}

test.describe("text editing", () => {
  test("row 1: double-click opens a `td-rt` contenteditable in the same box, without a layout shift", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    const title = elements(page).filter({ hasText: "The water cycle" }).first();
    await expect(title).toBeVisible();
    const before = await box(richText(title));
    const glyphBefore = await box(title.getByText("The water cycle"));

    await dblclickAt(page, title);
    const pm = proseMirror(page);
    await expect(pm).toBeFocused();
    await expect(pm).toHaveAttribute("contenteditable", "true");
    await expect(pm).toHaveClass(/td-rt/);
    // Exactly one `td-rt` in the box now — the editor's; the static one is gone, not hidden under it.
    await expect(title.locator(".td-rt")).toHaveCount(1);

    const after = await box(pm);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
    const glyphAfter = await box(pm.getByText("The water cycle"));
    expect(Math.abs(glyphAfter.x - glyphBefore.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(glyphAfter.y - glyphBefore.y)).toBeLessThanOrEqual(1);
    // The selection frame stays, its handles do not.
    await expect(page.locator("[data-selection-frame]")).toBeVisible();
    await expect(page.locator("[data-handle]")).toHaveCount(0);
  });

  test("row 1b: the lines a box shows do not re-wrap when editing starts (TEACH-112)", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(elements(page).first()).toBeVisible();
    // Tiptap injects `.ProseMirror { white-space: break-spaces }` on mount; under it a trailing
    // space takes up room on the line, so the last word of a tight line drops. Measure every
    // text box on the slide, edit the one with the most lines, and expect the same lines back.
    const probe = (root: Element) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const lines: { top: number; text: string }[] = [];
      let node = walker.nextNode();
      while (node) {
        const text = node.textContent ?? "";
        for (let i = 0; i < text.length; i++) {
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const rect = range.getClientRects()[0];
          const ch = text[i];
          if (!rect || ch === undefined) continue;
          const top = Math.round(rect.top);
          const last = lines[lines.length - 1];
          if (last && Math.abs(last.top - top) <= 2) last.text += ch;
          else lines.push({ top, text: ch });
        }
        node = walker.nextNode();
      }
      return lines.map((l) => ({ top: l.top, text: l.text.trim() }));
    };
    const boxes = await elements(page)
      .locator(".td-rt")
      .evaluateAll((nodes, fn) => {
        const measure = new Function(`return (${fn})`)() as (root: Element) => unknown[];
        return nodes.map((n) => ({
          id: n.closest("[data-element-id]")?.getAttribute("data-element-id") ?? "",
          lines: measure(n) as { top: number; text: string }[],
        }));
      }, probe.toString());
    const target = boxes.reduce((a, b) => (b.lines.length > a.lines.length ? b : a));
    expect(target.lines.length).toBeGreaterThan(1);
    const element = page.locator(`[data-slide-frame] [data-element-id="${target.id}"]`);
    // The wrap is the per-line text; the tops only guard against a vertical shift, so they get
    // a pixel of slack for caret layers and font metrics settling when the editor focuses.
    const expectSameLines = (got: { top: number; text: string }[]) => {
      expect(got.map((l) => l.text)).toEqual(target.lines.map((l) => l.text));
      const drift = got.map((l, i) => Math.abs(l.top - (target.lines[i]?.top ?? Number.NaN)));
      expect(Math.max(...drift)).toBeLessThanOrEqual(1);
    };

    await dblclickAt(page, element);
    const pm = proseMirror(page);
    await expect(pm).toBeFocused();
    expect(await pm.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("pre-wrap");
    const editing = await pm.evaluate((el, fn) => {
      const measure = new Function(`return (${fn})`)() as (root: Element) => unknown[];
      return measure(el) as { top: number; text: string }[];
    }, probe.toString());
    expectSameLines(editing);

    await page.keyboard.press("Escape");
    await expect(proseMirror(page)).toHaveCount(0);
    const after = await richText(element).evaluate((el, fn) => {
      const measure = new Function(`return (${fn})`)() as (root: Element) => unknown[];
      return measure(el) as { top: number; text: string }[];
    }, probe.toString());
    expectSameLines(after);
  });

  test("row 2: typing then Escape commits as one undo step and hands focus back to the canvas", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    const title = elements(page).filter({ hasText: "The water cycle" }).first();
    await dblclickAt(page, title);
    const pm = proseMirror(page);
    await expect(pm).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" abc");
    // Live: the canvas re-renders each keystroke, and the thumbnail follows.
    await expect(pm).toContainText("The water cycle abc");
    await expect(
      page.getByRole("listbox", { name: "Slides" }).getByRole("option").first(),
    ).toContainText("The water cycle abc");

    await page.keyboard.press("Escape");
    await expect(proseMirror(page)).toHaveCount(0);
    await expect(stage(page)).toBeFocused();
    await expect(title).toContainText("The water cycle abc");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });

    const undo = page.getByRole("button", { name: "Undo" });
    await undo.click();
    await expect(title).not.toContainText("abc");
    await expect(undo).toBeDisabled();
  });

  test("row 10: inside the editor, Delete and ⌘D edit text and never touch the element", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    const title = elements(page).filter({ hasText: "The water cycle" }).first();
    await expect(title).toBeVisible();
    const count = await elements(page).count();
    await dblclickAt(page, title);
    await expect(proseMirror(page)).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    await expect(proseMirror(page)).toContainText("The water cycl");
    await page.keyboard.press("ControlOrMeta+d");
    expect(await elements(page).count()).toBe(count);
    await page.keyboard.press("Escape");
    expect(await elements(page).count()).toBe(count);
  });

  test("row 4: with the editor open, the toolbar's Bold acts on the selection and lands in the doc", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    const title = elements(page).filter({ hasText: "The water cycle" }).first();
    await dblclickAt(page, title);
    await expect(proseMirror(page)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    const bold = page.getByRole("toolbar", { name: "Text" }).getByRole("button", { name: "Bold" });
    await bold.click();
    await expect(bold).toHaveAttribute("aria-pressed", "true");
    await expect(proseMirror(page).locator("strong")).toContainText("The water cycle");
    await page.keyboard.press("Escape");
    await expect(title.locator("strong")).toContainText("The water cycle");
  });

  test("row 7: an option card's label edits in place and Escape commits", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    // Slide 6 is the true/false check with two option cards.
    await page.getByRole("listbox", { name: "Slides" }).getByRole("option").nth(5).click();
    const option = page.locator('[data-slide-frame] [data-element-type="option"]').first();
    await expect(option).toContainText("True");
    await dblclickAt(page, option);
    const pm = proseMirror(page);
    await expect(pm).toBeFocused();
    expect(await option.locator(".ProseMirror").count()).toBe(1);
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await page.keyboard.press("Escape");
    await expect(option).toContainText("True!");
  });

  test("row 9: the Why? panel edits in the answer state; Escape closes it", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await page.getByRole("listbox", { name: "Slides" }).getByRole("option").nth(5).click();
    await page.getByRole("tab", { name: "Answer" }).click();
    const panel = page.locator("[data-explanation-panel]");
    await expect(panel).toBeVisible();
    const field = page.getByRole("textbox", { name: "Why this is the answer" });
    await dblclickAt(page, panel, field);
    await expect(field).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" Really.");
    await page.keyboard.press("Escape");
    await expect(field).toHaveCount(0);
    await expect(panel).toContainText("Really.");
    await expect(stage(page)).toBeFocused();
  });

  test("typing past the bottom edge never scrolls the slide inside its frame; Escape leaves it where it was", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    const title = elements(page).filter({ hasText: "The water cycle" }).first();
    const frame = page.locator("[data-slide-clip]");
    const root = page.locator("[data-slide-frame] [data-slide-root]");
    // Where the heading sits in the frame, before anything is typed.
    const offset = async () => (await box(title)).y - (await box(frame)).y;
    const scrolled = () =>
      Promise.all([frame, root].map((l) => l.evaluate((el) => [el.scrollTop, el.scrollLeft])));
    const before = await offset();

    await dblclickAt(page, title);
    const pm = proseMirror(page);
    await expect(pm).toBeFocused();
    await page.keyboard.press("End");
    for (let i = 1; i <= 8; i++) {
      await page.keyboard.press("Enter");
      await page.keyboard.type(`Line ${i}`);
    }
    // The caret is now below the slide's bottom edge: Chromium would caret-scroll an
    // `overflow: hidden` frame and push the heading up under the frame edge (t74-2 §2).
    await expect(pm).toContainText("Line 8");
    expect(await scrolled()).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(Math.abs((await offset()) - before)).toBeLessThan(1);
    // ...and the line under the caret is painted below the slide's edge, where a hand could
    // click it: the frame opens its bottom edge while a box is being typed into.
    const painted = (text: string) =>
      page.evaluate((t) => {
        const line = [...document.querySelectorAll("[data-slide-frame] .td-rt p")].find(
          (p) => p.textContent === t,
        );
        if (!line) return "no line";
        const b = line.getBoundingClientRect();
        const frame = document
          .querySelector("[data-slide-clip]")
          ?.getBoundingClientRect() as DOMRect;
        const hit = document.elementFromPoint(b.left + 8, b.top + b.height / 2);
        return { belowEdge: b.top >= frame.bottom, inSlide: !!hit?.closest("[data-slide-root]") };
      }, text);
    expect(await painted("Line 8")).toEqual({ belowEdge: true, inSlide: true });

    await page.keyboard.press("Escape");
    await expect(proseMirror(page)).toHaveCount(0);
    expect(await scrolled()).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(Math.abs((await offset()) - before)).toBeLessThan(1);
    // Clipped again: the same line sits past the edge and nothing of the slide is under it.
    expect(await painted("Line 8")).toEqual({ belowEdge: true, inSlide: false });
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(title).not.toContainText("Line 8");
  });
});

/*
 * TEACH-74 (topic graph PRD §5.6, TG-12): the first teacher edit of an AI-authored text keeps the
 * AI's words in the saved document. Seeds `generatedLesson()` (provenance on every element), so
 * `test.use({ seed: false })` and no demo library.
 */
test.describe("first teacher edit keeps the original AI text (TEACH-74)", () => {
  test.use({ seed: false });

  test("typing into an ai text flips it to teacher and saves generatedFrom.originalText", async ({
    signedInPage: { page },
  }) => {
    const seeded = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
      headers: { origin: E2E_WEB_URL },
      data: {
        documents: [
          {
            key: "lesson",
            kind: "lesson",
            body: { ...generatedLesson(), updatedAt: new Date().toISOString() },
          },
        ],
      },
    });
    expect(seeded.ok(), await seeded.text()).toBe(true);
    const lessonId = ((await seeded.json()) as { ids: Record<string, string> }).ids.lesson ?? "";
    expect(lessonId).toBeTruthy();

    await page.goto(`/l/${lessonId}`);
    // The fixture's title and subtitle share one rect; the subtitle (`t2`) is drawn last, so it
    // is the box a double-click lands on.
    const subtitle = page.locator('[data-slide-frame] [data-element-id="t2"]');
    await expect(subtitle).toContainText("Year 4 · Science");
    await dblclickAt(page, subtitle);
    const pm = proseMirror(page);
    await expect(pm).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" and rain");
    await page.keyboard.press("Escape");
    await expect(subtitle).toContainText("Year 4 · Science and rain");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });

    const saved = await page.request.get(`${E2E_API_URL}/documents/${lessonId}`, {
      headers: { origin: E2E_WEB_URL },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    const lesson = ((await saved.json()) as { document: { body: Lesson } }).document.body;
    const byId = (id: string) => lesson.slides[0]?.elements.find((e) => e.id === id);
    const edited = byId("t2");
    expect(edited?.authoredBy).toBe("teacher");
    expect(edited?.generatedFrom?.originalText).toBe("Year 4 · Science");
    expect(edited?.generatedFrom?.factRefs).toEqual([]);
    // The title the teacher never touched is still the AI's, with nothing recorded.
    const untouched = byId("t1");
    expect(untouched?.authoredBy).toBe("ai");
    expect(untouched?.generatedFrom?.originalText).toBeUndefined();
  });
});

/*
 * TEACH-74, with Tidy: a split shortens a box's words, and that is the engine's doing. Two slides
 * each carry an AI list too long for the slide; the teacher types into one and tidies both. The
 * typed list is the teacher's and keeps the AI's full words (the split does not overwrite them);
 * the list only tidied stays the AI's, with nothing recorded.
 */
test.describe("tidy after the first teacher edit (TEACH-74)", () => {
  test.use({ seed: false });

  const items = (tag: string) =>
    Array.from({ length: 12 }, (_, i) => `${tag} item ${i + 1} on this very long list of things`);
  const longList = (id: string, tag: string) =>
    generatedText(id, "", ["o1"], {
      y: 120,
      h: 300,
      doc: {
        type: "doc",
        content: items(tag).map((line) => ({
          type: "paragraph",
          content: [{ type: "text", text: line }],
        })),
      },
    });
  const listSlide = (id: string, tag: string, listId: string): Slide => ({
    id,
    kind: "content",
    elements: [
      generatedText(`${id}-h`, `${tag} heading`, [], { style: { preset: "heading" } }),
      longList(listId, tag),
    ],
  });

  test("typing then Tidy keeps originalText; Tidy alone leaves an ai list the AI's", async ({
    signedInPage: { page },
  }) => {
    const base = generatedLesson();
    const [title, ...rest] = base.slides;
    if (!title) throw new Error("fixture");
    const body: Lesson = {
      ...base,
      // Slide 2 is typed into, slide 3 only tidied; slide 3 is tidied first so its continuation
      // slide lands after it and slide 2 keeps its place.
      slides: [
        title,
        listSlide("s-typed", "Typed", "typed"),
        listSlide("s-tidied", "Tidied", "tidied"),
        ...rest,
      ],
      updatedAt: new Date().toISOString(),
    };
    const original = (id: string) =>
      plainTextOf(body.slides.flatMap((s) => s.elements).find((e) => e.id === id) as SlideElement);

    const seeded = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
      headers: { origin: E2E_WEB_URL },
      data: { documents: [{ key: "lesson", kind: "lesson", body }] },
    });
    expect(seeded.ok(), await seeded.text()).toBe(true);
    const lessonId = ((await seeded.json()) as { ids: Record<string, string> }).ids.lesson ?? "";
    expect(lessonId).toBeTruthy();

    await page.goto(`/l/${lessonId}`);
    const rows = page.getByRole("listbox", { name: "Slides" }).getByRole("option");
    const tidy = page.getByRole("toolbar", { name: "Slide" }).getByRole("button", {
      name: "Tidy slide",
    });
    const toast = page.getByText(/^Tidied: /);

    // Tidy alone, on slide 3: the list splits onto a continuation slide.
    await expect(rows).toHaveCount(body.slides.length);
    await rows.nth(2).click();
    await tidy.click();
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("continued on");
    await expect.poll(() => rows.count()).toBeGreaterThan(body.slides.length);
    const afterFirst = await rows.count();

    // Slide 2: type at the start of the list, leave the editor, then Tidy.
    await rows.nth(1).click();
    const list = page.locator('[data-slide-frame] [data-element-id="typed"]');
    const b = await box(list);
    await page.mouse.dblclick(b.x + 40, b.y + 15);
    await expect(proseMirror(page)).toBeFocused();
    // The editor opens with the caret at the end (and scrolled to it). ArrowUp until the caret is
    // in the first line, since Mod+Home differs by platform.
    const onFirstLine = () =>
      page.evaluate(() => {
        const at = getSelection()?.anchorNode;
        const first = document.querySelector("[data-slide-frame] .ProseMirror p");
        return Boolean(at && first?.contains(at));
      });
    for (let i = 0; i < 40 && !(await onFirstLine()); i++) await page.keyboard.press("ArrowUp");
    expect(await onFirstLine()).toBe(true);
    await page.keyboard.press("Home");
    // One input event: under load, per-key typing can race the editor's adopt-the-cache effect
    // (`use-inline-editor.ts`), which resets the caret to the end mid-word.
    await page.keyboard.insertText("Start: ");
    await page.keyboard.press("Escape");
    await expect(proseMirror(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-selection-frame]")).toHaveCount(0);
    await expect(list).toContainText("Start: ");
    await tidy.click();
    await expect(toast.first()).toBeVisible();
    await expect.poll(() => rows.count()).toBeGreaterThan(afterFirst);
    await expect(list).toContainText("Start: Typed item 1 ");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });

    // "Saved" was already up after the first Tidy, so wait for the second one to reach the api.
    const load = async () => {
      const saved = await page.request.get(`${E2E_API_URL}/documents/${lessonId}`, {
        headers: { origin: E2E_WEB_URL },
      });
      expect(saved.ok(), await saved.text()).toBe(true);
      return ((await saved.json()) as { document: { body: Lesson } }).document.body;
    };
    const slideCount = await rows.count();
    await expect.poll(async () => (await load()).slides.length).toBe(slideCount);
    const lesson = await load();
    const find = (id: string) =>
      lesson.slides.flatMap((s) => s.elements).find((e) => e.id === id) as SlideElement;

    // Typed, then split: the teacher's, with the AI's full words kept, not the split head.
    const typed = find("typed");
    const typedText = plainTextOf(typed) ?? "";
    expect(typedText).toMatch(/^Start: Typed item 1 /);
    expect(typedText).not.toContain("Typed item 12");
    expect(typed.authoredBy).toBe("teacher");
    expect(typed.generatedFrom?.originalText).toBe(original("typed"));
    expect(typed.generatedFrom?.factRefs).toEqual(["o1"]);

    // Tidied only: shorter words, but nobody typed — still the AI's, nothing recorded.
    const tidied = find("tidied");
    expect((plainTextOf(tidied) ?? "").length).toBeLessThan((original("tidied") ?? "").length);
    expect(tidied.authoredBy).toBe("ai");
    expect(tidied.generatedFrom).toBeDefined();
    expect(tidied.generatedFrom?.originalText).toBeUndefined();
    // Its tail on the continuation slide is the AI's words too.
    const tail = lesson.slides
      .flatMap((s) => s.elements)
      .find((e) => plainTextOf(e)?.includes("Tidied item 12"));
    expect(tail?.id).not.toBe("tidied");
    expect(tail?.authoredBy).toBe("ai");
    expect(tail?.generatedFrom?.originalText).toBeUndefined();
  });
});
