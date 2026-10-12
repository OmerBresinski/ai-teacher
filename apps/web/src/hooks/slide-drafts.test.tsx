import { describe, expect, it } from "bun:test";
import { renderHook } from "@testing-library/react";
import type { JobEvent, SlideDraftPayload } from "@tj/domain/jobs";
import { createDraftStore } from "@tj/editor/live-draft";
import {
  DRAFTS_AFTER_END_MS,
  type JobEventsState,
  reduceJobEvents,
  useFeedDrafts,
} from "./use-job-events";

/* Live writing (ADR 0039): slide drafts on the job stream, kept beside the events, never in them. */

const JOB_ID = "01a06a15-1849-7000-ac6a-c07e27fe308b";
const WORKSPACE_ID = "01a06a15-1849-7000-ac6a-c07e27fe3000";
const at = "2026-10-12T10:00:00.000Z";
const base = { jobId: JOB_ID, workspaceId: WORKSPACE_ID, at } as const;
const draft = (index: number, notes: string, final?: boolean): SlideDraftPayload => ({
  index,
  slideId: `s${index + 1}`,
  slide: { id: `s${index + 1}`, kind: "content", elements: [], notes },
  ...(final ? { final } : {}),
});
const ev = (e: JobEvent, id: string) => ({ type: "event" as const, event: e, id });
const start: JobEventsState = reduceJobEvents(
  { events: [], status: "open", percent: null, terminal: null, drafts: {} },
  { type: "status", status: "open" },
);

describe("slide drafts on the job stream", () => {
  it("keeps the newest draft per slide and leaves the event log alone", () => {
    let s = reduceJobEvents(
      start,
      ev({ type: "slide-draft", ...base, draft: draft(2, "a") } as JobEvent, "1"),
    );
    s = reduceJobEvents(
      s,
      ev({ type: "slide-draft", ...base, draft: draft(2, "a b") } as JobEvent, "2"),
    );
    s = reduceJobEvents(
      s,
      ev({ type: "slide-draft", ...base, draft: draft(3, "c") } as JobEvent, "3"),
    );
    expect(s.events).toEqual([]);
    expect(s.drafts.s3?.slide.notes).toBe("a b");
    expect(s.drafts.s4?.slide.notes).toBe("c");
    // A replay after a reconnect only overwrites: the newest still wins.
    s = reduceJobEvents(
      s,
      ev({ type: "slide-draft", ...base, draft: draft(2, "a b c", true) } as JobEvent, "4"),
    );
    expect(s.drafts.s3?.final).toBe(true);
  });

  it("clears the drafts when the job ends and takes no more after it", () => {
    let s = reduceJobEvents(
      start,
      ev({ type: "slide-draft", ...base, draft: draft(2, "a") } as JobEvent, "1"),
    );
    s = reduceJobEvents(s, ev({ type: "completed", ...base } as JobEvent, "2"));
    expect(s.drafts).toEqual({});
    s = reduceJobEvents(
      s,
      ev({ type: "slide-draft", ...base, draft: draft(3, "late") } as JobEvent, "3"),
    );
    expect(s.drafts).toEqual({});
  });

  it("an empty stream never clears the store while the job runs; the job's end does", async () => {
    const store = createDraftStore();
    store.set([{ ...draft(2, "kept") }]);
    const { rerender } = renderHook(
      ({ drafts, ended }: { drafts: JobEventsState["drafts"]; ended: boolean }) =>
        useFeedDrafts(store, drafts, ended),
      { initialProps: { drafts: {}, ended: false } },
    );
    expect(store.get("s3")?.slide.notes).toBe("kept");
    rerender({ drafts: { s4: draft(3, "next") }, ended: false });
    expect(store.latest()?.slideId).toBe("s4");
    rerender({ drafts: {}, ended: true });
    // The last slide keeps its draft while the last save reaches the document, then it goes.
    expect(store.latest()?.slideId).toBe("s4");
    await new Promise((r) => setTimeout(r, DRAFTS_AFTER_END_MS + 50));
    expect(store.latest()).toBeUndefined();
  });

  it("a replay that arrives oldest first never steps the store back to an older draft", () => {
    const store = createDraftStore();
    store.set([{ ...draft(2, "newest words"), seq: 40 }]);
    renderHook(() => useFeedDrafts(store, { s3: { ...draft(2, "old"), seq: 12 } }, false));
    expect(store.get("s3")?.slide.notes).toBe("newest words");
    let s = reduceJobEvents(
      start,
      ev({ type: "slide-draft", ...base, draft: draft(2, "a") } as JobEvent, "7"),
    );
    expect(s.drafts.s3?.seq).toBe(7);
    s = reduceJobEvents(
      s,
      ev({ type: "slide-draft", ...base, draft: draft(2, "a b") } as JobEvent, "9"),
    );
    expect(s.drafts.s3?.seq).toBe(9);
  });
});
