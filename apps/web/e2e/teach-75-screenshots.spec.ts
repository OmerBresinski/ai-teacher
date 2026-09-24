/**
 * TEACH-75 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-75-screenshots.spec.ts`;
 * `TEACH_SHOTS_DIR` is where the PNGs land (default `/tmp`). Shoot against a production build of the
 * web app (the default ports' `vite preview`), not Vite dev: dev mounts the "Design preview" switcher and router devtools over the
 * page, and the switcher lands in the top right of every present-mode crop.
 *
 * The seeded demo's content slide with its "WATCH OUT" card in the editor, in present and as the
 * navigator thumbnail; then a fixture deck through `chooseVariant` carrying every callout kind on
 * a content slide (headed and two-column) and an image-text slide, and a worked example that
 * goes without (measured: no room under the working card), on Chalk, Exam Hall and Night Lab.
 */
import type { Lesson } from "@tj/domain/documents";
import { demoLessonSlides, newLesson } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

// `@tj/web` does not declare `@tj/slides`; the spec type comes through the starter entry.
type SlideSpec = NonNullable<NonNullable<Parameters<typeof demoLessonSlides>[1]>["specs"]>[number];

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });
test.setTimeout(300_000);

const OUT = process.env.TEACH_SHOTS_DIR ?? "/tmp";
const THEMES = ["chalk", "exam-hall", "night-lab"] as const;

/** Thirty-one words: over the twenty-four a callout allows a headed body, within what two columns hold. */
const LONG_BODY =
  "The sun heats water in rivers, lakes and seas until it evaporates into water vapour. High in the sky the vapour cools and condenses into tiny droplets that gather into cloud.";

/** One slide per (host, kind); the file each is shot to. */
const FIXTURE: { spec: SlideSpec; file: string }[] = [
  {
    spec: { kind: "title", factRefs: [], title: "The water cycle", subtitle: "Year 5 science" },
    file: "title",
  },
  {
    spec: {
      kind: "content",
      factRefs: ["o1"],
      heading: "The sun powers the whole cycle",
      body: "The sun heats water until it evaporates into water vapour. High in the sky the vapour cools and condenses into cloud.",
      callout: {
        kind: "watch-out",
        text: "Clouds are tiny drops of liquid water, not water vapour; vapour is invisible.",
      },
    },
    file: "content-headed-watch-out",
  },
  {
    spec: {
      kind: "content",
      factRefs: ["o1"],
      heading: "Condensation makes the cloud",
      body: LONG_BODY,
      callout: {
        kind: "example",
        text: "Breathe on a cold window: the mist is vapour from your breath condensing.",
      },
    },
    file: "content-two-column-example",
  },
  {
    spec: {
      kind: "content",
      factRefs: ["v1"],
      heading: "Three words for three changes",
      body: "Water evaporates, condenses and falls. Each change has a name, and each name tells you which way the water is going.",
      callout: { kind: "key-words", text: "evaporation, condensation, precipitation" },
    },
    file: "content-headed-key-words",
  },
  {
    spec: {
      kind: "image-text",
      factRefs: ["o2"],
      heading: "Clouds over the sea",
      body: "Warm air rises from the sea carrying water vapour with it.",
      callout: { kind: "watch-out", text: "The cloud is water, not steam." },
    },
    file: "image-text-watch-out",
  },
  {
    spec: {
      kind: "image-text",
      factRefs: ["o2"],
      heading: "Rain on the hills",
      body: "Air pushed up over hills cools, so the windward side is wetter.",
      callout: { kind: "example", text: "Manchester is wetter than Sheffield for this reason." },
    },
    file: "image-text-example",
  },
  {
    spec: {
      kind: "image-text",
      factRefs: ["v2"],
      heading: "Where the water collects",
      body: "Rain runs into streams and rivers and back to the sea.",
      callout: { kind: "key-words", text: "collection, run-off, river" },
    },
    file: "image-text-key-words",
  },
  {
    spec: {
      kind: "worked-example",
      factRefs: ["w1"],
      heading: "Why does a puddle disappear?",
      question: "A puddle dries up on a sunny day. Where did the water go?",
      steps: [
        "The sun warms the puddle.",
        "Warm water evaporates into vapour.",
        "The vapour rises into the air.",
        "The puddle shrinks until it is gone.",
      ],
      callout: { kind: "example", text: "Washing dries on the line the same way." },
    },
    file: "worked-example-goes-without",
  },
];

function fixtureLesson(key: string, themeId: string): Lesson {
  const lesson: Lesson = { ...newLesson("The water cycle", themeId), id: key };
  lesson.slides = demoLessonSlides(themeId, { specs: FIXTURE.map((f) => f.spec) }).slides;
  return lesson;
}

test("captures the demo's callout in the editor, present and the navigator, then every kind on three themes", async ({
  signedInPage: { page, paths },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));

  // The seeded demo, slide 5, in the editor.
  await page.goto(paths.lesson("demo-water-cycle"));
  const rows = page.getByRole("listbox", { name: "Slides" }).getByRole("option");
  await expect(rows.nth(4)).toHaveAttribute("aria-label", "Slide 5, Explanation");
  await rows.nth(4).click();
  const stage = page.locator("[data-slide-frame]");
  await expect(stage.getByText("WATCH OUT")).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/editor-demo-content-watch-out.png` });
  await rows
    .nth(4)
    .locator("[data-navigator-thumb]")
    .screenshot({
      path: `${OUT}/navigator-thumb-demo-content.png`,
    });

  /** Open slide `n` on the stage: `?slide=` sets the slide, the start gate still asks. */
  const shoot = async (id: string | undefined, n: number, file: string) => {
    await page.goto(`/l/${id}/present?slide=${n}`);
    await page.getByRole("button", { name: "Stay in this window" }).click();
    await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
    await expect(page.getByRole("status").first()).toContainText(`Slide ${n} of`);
    await page.waitForTimeout(600);
    await page.locator('[data-slide-mode="present"]').screenshot({ path: file });
  };
  await shoot(paths.id("demo-water-cycle"), 5, `${OUT}/present-demo-content-watch-out.png`);

  // The fixture deck on three themes.
  const documents = THEMES.map((themeId) => ({
    key: `t75-${themeId}`,
    kind: "lesson",
    body: fixtureLesson(`t75-${themeId}`, themeId),
  }));
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents },
  });
  expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };
  for (const themeId of THEMES) {
    for (const [i, { file }] of FIXTURE.entries()) {
      if (file === "title") continue;
      await shoot(ids[`t75-${themeId}`], i + 1, `${OUT}/${themeId}-${file}.png`);
    }
  }
});
