import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { lesson as baseLesson, creditedLesson } from "@tj/domain/documents/fixtures";
import { LessonPrint } from "./LessonPrint";

/* TEACH-251: no credits page, and with PDF_ATTRIBUTION "off" no credit on the slide either. */

afterEach(cleanup);

const main = () => screen.getByRole("main");

const commons = (id: string, licence: string) => ({
  provider: "commons" as const,
  id,
  pageUrl: `https://commons.wikimedia.org/wiki/File:${id}.jpg`,
  photographer: "Basile Morin",
  photographerUrl: `https://commons.wikimedia.org/wiki/File:${id}.jpg`,
  author: "Basile Morin",
  licence,
  sourceUrl: `https://commons.wikimedia.org/wiki/File:${id}.jpg`,
});

/** The credited fixture with one more slide: a CC BY-SA calf, shown cropped, and a CC0 cow. */
function withCommons() {
  const base = creditedLesson();
  const pic = (id: string, source: ReturnType<typeof commons>, fit: "cover" | "contain") => ({
    id,
    type: "image" as const,
    x: 40,
    y: 40,
    w: 300,
    h: 200,
    src: "data:,",
    alt: id,
    fit,
    source,
  });
  const slide = {
    id: "commons-slide",
    kind: "content" as const,
    elements: [
      pic("calf", commons("Standing_calf", "CC BY-SA 4.0"), "cover"),
      pic("cow", commons("Cow", "CC0"), "contain"),
    ],
  };
  return { ...base, slides: [...base.slides, slide] } as never as ReturnType<typeof creditedLesson>;
}

describe("LessonPrint image credits", () => {
  it("ends on no credits page, in every layout", () => {
    for (const options of [{}, { notes: true }, { handout3: true }]) {
      const { unmount } = render(<LessonPrint lesson={withCommons()} options={options} />);
      expect(main().querySelector("[data-credits-page]")).toBeNull();
      expect(screen.queryByText("Image credits")).toBeNull();
      unmount();
    }
    // One page per slide (five here), or three slides to a page: nothing is added.
    const { unmount } = render(<LessonPrint lesson={withCommons()} />);
    expect(main().dataset.pageCount).toBe("5");
    unmount();
    render(<LessonPrint lesson={withCommons()} options={{ handout3: true }} />);
    expect(main().dataset.pageCount).toBe("2");
  });

  it("prints a CC BY-SA picture as it is, with no credit line (PDF_ATTRIBUTION off)", () => {
    render(<LessonPrint lesson={withCommons()} />);
    expect(main().querySelectorAll("[data-print-credit]")).toHaveLength(0);
    expect(screen.queryByText(/Basile Morin/)).toBeNull();
    const slide = main().querySelector('[data-slide-index="5"]');
    expect(slide?.querySelector('img[alt="calf"]')).toBeTruthy();
  });
});

/* TEACH-247: the print route (PDF) draws every figure in its own box, at the last build. */
describe("LessonPrint drawn diagrams", () => {
  it("each diagram and picture lands at its element box, the diagram as stored (every part)", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/><g data-s="1"><circle/></g></svg>';
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const base = baseLesson();
    const first = base.slides[0];
    if (!first) throw new Error("fixture");
    const figures = [
      { id: "dg1", name: "Diagram", x: 520, y: 160, w: 400, h: 300, src, builds: 1 },
      { id: "dg2", name: "Diagram", x: 40, y: 120, w: 788, h: 235, src, builds: 1 },
      { id: "ph1", name: "Picture", x: 40, y: 380, w: 200, h: 120, src: "data:," },
    ].map((f) => ({ ...f, type: "image" as const, fit: "contain" as const, alt: f.id }));
    const lesson = { ...base, slides: [{ ...first, elements: figures }] };
    render(<LessonPrint lesson={lesson} options={{ slides: "1" }} />);
    for (const f of figures) {
      const frame = main().querySelector<HTMLElement>(`[data-element-id="${f.id}"]`);
      if (!frame) throw new Error(`no frame for ${f.id}`);
      expect([frame.style.left, frame.style.top, frame.style.width, frame.style.height]).toEqual(
        [f.x, f.y, f.w, f.h].map((v) => `${v}px`),
      );
      expect(frame.querySelector("img")?.getAttribute("src")).toBe(f.src);
    }
  });
});
