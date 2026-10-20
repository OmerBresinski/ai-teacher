import { describe, expect, mock, test } from "bun:test";
import { act, render } from "@testing-library/react";
import type { Slide } from "@tj/domain/documents";
import { renderTheme } from "../model/themes";
import { createDraftStore } from "./live-draft";
import { MobileSlideList } from "./MobileSlideList";
import { NO_PROPOSALS, ProposalsContext } from "./proposals-context";
import { seededLesson } from "./test-harness";

/*
 * UX audit J7: on a phone the lesson list follows the writing the way the desktop canvas does, so
 * the slides arriving are seen rather than the first two under the companion for the whole run.
 */
describe("MobileSlideList follow", () => {
  const lesson = seededLesson();
  const theme = renderTheme(lesson);
  const ids = lesson.slides.map((s) => s.id);

  function list(followId: string | undefined) {
    return <MobileSlideList slides={lesson.slides} theme={theme} followId={followId} />;
  }

  test("scrolls to the followed slide's card each time the followed slide changes", () => {
    const scrollTo = mock();
    const proto = HTMLElement.prototype as unknown as { scrollTo: unknown };
    const was = proto.scrollTo;
    proto.scrollTo = scrollTo;
    try {
      const view = render(list(ids[1]));
      expect(scrollTo).toHaveBeenCalledTimes(1);
      view.rerender(list(ids[1]));
      expect(scrollTo).toHaveBeenCalledTimes(1);
      view.rerender(list(ids[2]));
      expect(scrollTo).toHaveBeenCalledTimes(2);
      expect(scrollTo.mock.calls[1]?.[0]).toMatchObject({ top: expect.any(Number) });
    } finally {
      proto.scrollTo = was;
    }
  });

  test("does not move once the follow has ended (no followed slide)", () => {
    const scrollTo = mock();
    const proto = HTMLElement.prototype as unknown as { scrollTo: unknown };
    const was = proto.scrollTo;
    proto.scrollTo = scrollTo;
    try {
      const view = render(list(undefined));
      view.rerender(list(undefined));
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      proto.scrollTo = was;
    }
  });
});

/*
 * Greg's answer 68: a phone card shows the slide being written typing in from its draft, as the
 * desktop canvas does, and the saved copy once the slide is done.
 */
describe("MobileSlideList drafts", () => {
  const doc = (text: string) => ({
    type: "doc" as const,
    content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }],
  });
  const textSlide = (id: string, text: string): Slide => ({
    id,
    kind: "content",
    elements: [
      {
        id: "d-1",
        type: "text",
        x: 64,
        y: 46,
        w: 832,
        h: 120,
        doc: doc(text),
        style: { preset: "body", fontSize: 28 },
      } as Slide["elements"][number],
    ],
  });

  test("a writing slide's card shows its draft; without a draft store it shows the saved slide", () => {
    const lesson = seededLesson();
    const theme = renderTheme(lesson);
    const target = lesson.slides[1];
    if (!target) throw new Error("seeded lesson has no second slide");
    const drafts = createDraftStore();
    const view = render(
      <ProposalsContext.Provider
        value={{ ...NO_PROPOSALS, drafts, writingSlideIds: new Set([target.id]) }}
      >
        <MobileSlideList slides={lesson.slides} theme={theme} />
      </ProposalsContext.Provider>,
    );
    act(() =>
      drafts.set([{ index: 1, slideId: target.id, slide: textSlide(target.id, "Halves") }]),
    );
    const card = view.container.querySelector(`[data-mobile-slide="${target.id}"]`);
    expect(card?.querySelector("[data-live-slide]")).not.toBeNull();
    view.unmount();
    const plain = render(<MobileSlideList slides={lesson.slides} theme={theme} />);
    expect(plain.container.querySelector("[data-live-slide]")).toBeNull();
  });
});
