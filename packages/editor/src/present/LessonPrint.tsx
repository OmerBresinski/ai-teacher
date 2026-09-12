import type { Lesson, Slide } from "@tj/domain/documents";
import { useEffect, useMemo, useRef } from "react";
import { CAPTURE_READY_ATTR, waitForSlidePaint } from "../export/paint";
import { parseSlideRange } from "../export/range";
import { getTheme } from "../model/themes";
import { SlideView } from "../slide/SlideView";

/**
 * The lesson print layout (TeachDeck `app/l/[id]/print/page.tsx`; ADR 0023 §2). One slide per
 * landscape page at 960x540pt, an A4 page with the presenter notes when `notes`, or three slides to
 * an A4 page with note lines beside each when `handout3`. `slides` prints only those slides, using
 * the same parser the export dialog validates its field with, so the page count is the one the
 * dialog named. A range that will not parse prints the whole deck rather than nothing: the field that
 * produces it refuses to submit, so a bad one can only have been typed into the address bar.
 *
 * `auto` prints as soon as the deck has painted (fonts and every image), so "Export PDF" is one
 * click; the route sets `data-capture-ready` on `<html>` at the same moment so a headless renderer
 * can wait on it rather than a timer. The page that mounts this imports
 * `@tj/editor/styles/lesson-print.css`. Images are plain `<img>`; the browser's own request carries
 * the session cookie to `/files/:key` (ADR 0023 amendment 2026-09-12).
 */
export type LessonPrintOptions = {
  auto?: boolean;
  answers?: boolean;
  notes?: boolean;
  handout3?: boolean;
  /** As typed: "All", "1-3, 5". */
  slides?: string;
};

export type LessonPrintProps = { lesson: Lesson; options?: LessonPrintOptions };

/** One printed slide keeps its number in the lesson, whatever the range asked for. */
type Page = { slide: Slide; number: number };

function chunk(items: Page[], size: number): Page[][] {
  const out: Page[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function LessonPrint({ lesson, options = {} }: LessonPrintProps) {
  const { auto = false, answers = false, notes = false, handout3 = false, slides = "" } = options;
  const theme = getTheme(lesson.themeId);
  const printed = useRef(false);
  const root = useRef<HTMLDivElement>(null);

  const pages = useMemo<Page[]>(() => {
    const parsed = parseSlideRange(slides, lesson.slides.length);
    const indices = parsed.ok ? parsed.indices : lesson.slides.map((_, i) => i);
    return indices.flatMap((i) => {
      const slide = lesson.slides[i];
      return slide ? [{ slide, number: i + 1 }] : [];
    });
  }, [lesson.slides, slides]);

  // Ready only once the type and the pictures have landed, or the first page prints with fallback
  // fonts and empty image boxes. The one external subscription here: the document's paint. It
  // re-arms whenever what is on the page changes (a refetched lesson, another range or layout on
  // the same route), so the ready marker never describes a previous render; `printed` still holds,
  // so the dialog opens once per mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pages and options are the trigger (what was painted), not a read
  useEffect(() => {
    let cancelled = false;
    const settle = async () => {
      await waitForSlidePaint(root.current ?? document);
      if (cancelled) return;
      document.documentElement.setAttribute(CAPTURE_READY_ATTR, "true");
      if (auto && !printed.current) {
        printed.current = true;
        window.print();
      }
    };
    void settle();
    return () => {
      cancelled = true;
      document.documentElement.removeAttribute(CAPTURE_READY_ATTR);
    };
  }, [auto, pages, answers, notes, handout3]);

  const a4 = notes || handout3;
  const pageCss = a4
    ? "@page { size: A4 portrait; margin: 12mm 8mm }"
    : "@page { size: 960pt 540pt; margin: 0 }";
  const total = lesson.slides.length;
  const pageCount = handout3 ? Math.ceil(pages.length / 3) : pages.length;
  const reveal = (slide: Slide) => answers && !!slide.question;

  return (
    <>
      <style>{pageCss}</style>
      {/* The page's one landmark: the route renders no app chrome around it (ADR 0023 §2). */}
      <main
        ref={root}
        className="td-print"
        data-lesson-id={lesson.id}
        data-page-count={pageCount}
        aria-label={lesson.title}
      >
        {handout3
          ? chunk(pages, 3).map((group) => (
              <section key={group[0]?.slide.id} className="td-handout3-page">
                {group.map(({ slide, number }) => (
                  <div key={slide.id} className="td-handout3-row" data-slide-index={number}>
                    <div className="td-handout3-slide">
                      <div className="td-handout3-scale">
                        <SlideView
                          slide={slide}
                          theme={theme}
                          mode="capture"
                          revealAnswer={reveal(slide)}
                        />
                      </div>
                    </div>
                    <div className="td-handout3-side">
                      <p className="td-handout-meta">
                        Slide {number} of {total}
                      </p>
                      <div className="td-handout3-lines" aria-hidden />
                    </div>
                  </div>
                ))}
              </section>
            ))
          : pages.map(({ slide, number }) =>
              notes ? (
                <section key={slide.id} className="td-handout-page" data-slide-index={number}>
                  <p className="td-handout-meta">
                    {lesson.title} · Slide {number} of {total}
                  </p>
                  <div className="td-handout-slide">
                    <div className="td-handout-scale">
                      <SlideView
                        slide={slide}
                        theme={theme}
                        mode="capture"
                        revealAnswer={reveal(slide)}
                      />
                    </div>
                  </div>
                  <p className="td-handout-notes" data-empty={!slide.notes?.trim()}>
                    {slide.notes?.trim() || "No presenter notes for this slide."}
                  </p>
                  <div className="td-handout-lines" aria-hidden />
                </section>
              ) : (
                <section key={slide.id} className="td-print-page" data-slide-index={number}>
                  <div className="td-print-scale">
                    <SlideView
                      slide={slide}
                      theme={theme}
                      mode="capture"
                      revealAnswer={reveal(slide)}
                    />
                  </div>
                </section>
              ),
            )}
      </main>
    </>
  );
}
