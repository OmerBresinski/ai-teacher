import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import type { Lesson, Slide, SlideElement } from "@tj/domain/documents";
import { answerRevealSteps, slideStepCount } from "@tj/domain/documents";
import { buildCount, svgOfDataUrl } from "@tj/slides/diagram-builds";
import JSZip from "jszip";
import { exportLessonPptx } from "../export/pptx";
import { demoLibrary } from "../model/starter";
import { getTheme } from "../model/themes";
import { SlideView } from "./SlideView";

/*
 * TEACH-247 part h: a library model as generation stores it (fixtures/library-food-chain.svg.txt is the
 * worker's own render of food_chain's first preset) is an ordinary drawn diagram: the editor shows
 * the still, Present plays its builds, and the PPTX gets it as a picture.
 */
const svg = readFileSync(join(import.meta.dir, "fixtures/library-food-chain.svg.txt"), "utf8");
const builds = buildCount(svg);
const element = {
  id: "lib1",
  type: "image",
  name: "Diagram",
  x: 80,
  y: 160,
  w: 800,
  h: 397,
  src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  alt: "A food chain: grass is eaten by a rabbit, which is eaten by a fox.",
  fit: "contain",
  builds,
} as SlideElement & { src: string };
const [demo] = demoLibrary();
if (!demo?.slides[0]) throw new Error("fixture");
const slide: Slide = { ...demo.slides[0], elements: [element] };
const theme = getTheme(demo.themeId);
const shown = (mode: "edit" | "present", step?: number) => {
  const { container } = render(
    <SlideView slide={slide} theme={theme} mode={mode} {...(step !== undefined ? { step } : {})} />,
  );
  return svgOfDataUrl(container.querySelector("img")?.getAttribute("src") ?? "") ?? "";
};

describe("a library model on a slide", () => {
  test("it carries its builds and its own type and font", () => {
    expect(builds).toBeGreaterThan(0);
    expect(svg).toContain('class="slide tk theme-primary"');
    expect(svg).toContain('@font-face{font-family:"Lexend"');
  });

  test("the editor shows the stored still", () => {
    expect(shown("edit")).toBe(svg);
  });

  test("Present plays one build per step, then the whole drawing", () => {
    expect(slideStepCount(slide)).toBe(builds);
    expect(shown("present", 0)).toContain(`[data-s="${builds}"]{opacity:0}`);
    expect(shown("present", builds)).not.toContain("{opacity:0}");
  });

  test("the PPTX gets it as a PNG, once, at its box", async () => {
    const lesson: Lesson = { ...demo, slides: [slide] };
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const asked: string[] = [];
    const blob = await exportLessonPptx(lesson, theme, {
      rasteriseSvg: async (s, w, h) => {
        asked.push(`${w}x${h}:${s === element.src}`);
        return png;
      },
      onWarning: (m) => {
        throw new Error(m);
      },
    });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const media = Object.keys(zip.files).filter((f) => f.startsWith("ppt/media/"));
    expect(asked).toEqual(["800x397:true"]);
    expect(media.some((f) => f.endsWith(".png"))).toBe(true);
    expect(media.some((f) => f.endsWith(".svg"))).toBe(false);
  }, 30_000);
});

/*
 * TEACH-247 part i: a library model on a question slide (fixtures/library-question-equal-groups.svg.txt,
 * the worker's render of "one half of 16" at its question build, font stripped) is a still whose
 * answer is held back. Present opens on the counters and empty rings; the answer reveal shows the
 * groups of 8; the editor and the PPTX keep the stored drawing, whose own style hides the answer.
 */
const qsvg = readFileSync(
  join(import.meta.dir, "fixtures/library-question-equal-groups.svg.txt"),
  "utf8",
);
const qSlide = demo.slides.find((s) => s.question && answerRevealSteps(s) > 0);
describe("a library model on a question slide", () => {
  if (!qSlide) throw new Error("no demo question slide with an answer reveal");
  const qElement = {
    ...element,
    id: "libq",
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qsvg)}`,
    builds: 0,
  } as SlideElement & { src: string };
  const s: Slide = { ...qSlide, elements: [...qSlide.elements, qElement] };
  const img = (mode: "edit" | "present", step?: number, revealAnswer = false) => {
    const { container } = render(
      <SlideView
        slide={s}
        theme={theme}
        mode={mode}
        revealAnswer={revealAnswer}
        {...(step !== undefined ? { step } : {})}
      />,
    );
    const src = [...container.querySelectorAll("img")]
      .map((i) => i.getAttribute("src") ?? "")
      .find((x) => x.includes(encodeURIComponent("data-reveal")));
    return svgOfDataUrl(src ?? "") ?? "";
  };
  const REVEALED = '[data-reveal="1"][data-reveal]{opacity:1}';

  test("it is a still with its answer held back by its own style", () => {
    expect(buildCount(qsvg) === 0).toBe(true);
    expect(qsvg).toContain('[data-reveal="1"]{opacity:0}');
  });

  test("Present opens with the answer hidden; the answer reveal shows it", () => {
    const last = slideStepCount(s);
    expect(img("present", 0)).not.toContain(REVEALED);
    expect(img("present", 0)).toContain("data-qn");
    expect(img("present", last, true)).toContain(REVEALED);
  });

  test("the editor shows the stored drawing: the question", () => {
    expect(img("edit")).toBe(qsvg);
  });
});
