import { describe, expect, test } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import { type JobEvent, LIVE_BLANK } from "@tj/domain/jobs";
import { latestLive, liveView } from "./live-writing";

const text = (id: string, words: string) => ({
  id,
  type: "text" as const,
  x: 48,
  y: 48,
  w: 400,
  h: 88,
  style: { preset: "body" as const },
  doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] },
});
const slide = (elements: unknown[]): Slide =>
  ({ id: "s", kind: "content", elements, background: {} }) as unknown as Slide;
const PLACEHOLDER =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Crect fill='%23E9E8E3'/%3E%3C/svg%3E";

const docText = (s: Slide, i: number) =>
  JSON.stringify((s.elements[i] as unknown as { doc: unknown }).doc).match(/"text":"([^"]*)"/)?.[1];

describe("live writing in the generating editor", () => {
  test("the newest live copy of each slide wins", () => {
    const at = "2026-09-30T00:00:00.000Z";
    const base = { jobId: "j", workspaceId: "w", at } as const;
    const events = [
      { ...base, type: "progress", progress: { live: { index: 2, kind: "hinge" } } },
      {
        ...base,
        type: "progress",
        progress: { live: { index: 2, kind: "hinge", slide: { id: "a" } } },
      },
      { ...base, type: "progress", progress: { percent: 40 } },
      { ...base, type: "progress", progress: { live: { index: 3, kind: "sort" } } },
    ] as unknown as JobEvent[];
    const live = latestLive(events);
    expect([...live.keys()]).toEqual([2, 3]);
    expect(live.get(2)?.slide).toMatchObject({ id: "a" });
  });

  test("an unwritten text and a placeholder photo are blanks; written words stay", () => {
    const blank = `${LIVE_BLANK.repeat(5)} ${LIVE_BLANK.repeat(5)}`;
    const view = liveView(
      slide([
        text("t1", "Heating can melt ice"),
        text("t2", blank),
        text("t3", `The particles ${blank}`),
        { id: "p", type: "image", x: 480, y: 48, w: 420, h: 400, src: PLACEHOLDER, fit: "cover" },
      ]),
    );
    expect(view.blanks.map((b) => b.kind)).toEqual(["text", "picture"]);
    expect(docText(view.slide, 0)).toBe("Heating can melt ice");
    expect(docText(view.slide, 2)).toBe("The particles ");
  });

  test("typing cuts the slide's words in reading order", () => {
    const view = liveView(slide([text("a", "The particle"), text("b", "Year 7")]), 8);
    expect(docText(view.slide, 0)).toBe("The part");
    expect(docText(view.slide, 1)).toBeUndefined();
  });

  test("a landed photo gets a new id so it fades in", () => {
    const src = "https://images.pexels.com/photos/1/a.jpeg";
    const view = liveView(
      slide([{ id: "p", type: "image", x: 0, y: 0, w: 1, h: 1, src, fit: "cover" }]),
    );
    expect(view.slide.elements[0]?.id).not.toBe("p");
    expect(view.blanks).toEqual([]);
  });
});
