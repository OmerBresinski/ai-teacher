import { describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import { renderTheme } from "../model/themes";
import { MobileSlideList } from "./MobileSlideList";
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
