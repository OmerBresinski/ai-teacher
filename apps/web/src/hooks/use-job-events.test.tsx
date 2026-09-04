import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import type { JobEvent } from "@tj/domain/jobs";
import { JobEventList } from "@/components/job-event-list";
import { FakeEventSource, installFakeEventSource } from "@/test/fake-event-source";
import { useJobEvents } from "./use-job-events";

const JOB_ID = "01a06a15-1849-7000-ac6a-c07e27fe308b";
const WORKSPACE_ID = "01a06a15-1849-7000-ac6a-c07e27fe3000";

function event<T extends JobEvent["type"]>(
  type: T,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type,
    jobId: JOB_ID,
    workspaceId: WORKSPACE_ID,
    at: "2026-09-04T10:00:00.000Z",
    ...extra,
  };
}

function Harness({ jobId }: { jobId: string | undefined }) {
  const state = useJobEvents(jobId);
  return (
    <div>
      <output data-testid="status">{state.status}</output>
      <output data-testid="percent">{state.percent ?? "none"}</output>
      <JobEventList events={state.events} />
    </div>
  );
}

// `installFakeEventSource()` swaps the global; put the real one back so nothing leaks between files.
const originalEventSource = globalThis.EventSource;

describe("useJobEvents", () => {
  beforeEach(() => {
    installFakeEventSource();
  });
  afterEach(() => {
    globalThis.EventSource = originalEventSource;
  });

  it("does not connect without a job id", () => {
    render(<Harness jobId={undefined} />);
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
    expect(screen.getByText("No events yet.")).toBeInTheDocument();
  });

  it("opens the per-job SSE url with credentials and renders parsed events", () => {
    render(<Harness jobId={JOB_ID} />);
    const source = FakeEventSource.latest;
    expect(source.url).toBe(`/api/jobs/${JOB_ID}/events`);
    expect(source.withCredentials).toBe(true);

    act(() => source.open());
    expect(screen.getByTestId("status")).toHaveTextContent("open");

    act(() => {
      source.emit("started", event("started"), "1");
      source.emit(
        "progress",
        event("progress", { progress: { percent: 40, message: "step 2/5" } }),
        "2",
      );
    });
    expect(screen.getByText("started")).toBeInTheDocument();
    expect(screen.getByText("progress 40% — step 2/5")).toBeInTheDocument();
    expect(screen.getByTestId("percent")).toHaveTextContent("40");
    expect(source.closed).toBe(false);
  });

  it("ignores unknown or malformed payloads with a warning", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    render(<Harness jobId={JOB_ID} />);
    const source = FakeEventSource.latest;
    act(() => {
      source.emit("progress", "not json");
      source.emit("progress", { type: "progress", nope: true });
      source.emit("message", { type: "teleported", jobId: JOB_ID });
    });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(screen.getByText("No events yet.")).toBeInTheDocument();
    warn.mockRestore();
  });

  it("closes the stream on a terminal event and sets percent to 100 when completed", () => {
    render(<Harness jobId={JOB_ID} />);
    const source = FakeEventSource.latest;
    act(() => {
      source.emit("progress", event("progress", { progress: { percent: 80 } }), "1");
      source.emit("completed", event("completed"), "2");
    });
    expect(source.closed).toBe(true);
    expect(screen.getByTestId("status")).toHaveTextContent("closed");
    expect(screen.getByTestId("percent")).toHaveTextContent("100");
    expect(screen.getByRole("list", { name: "Job events" }).children).toHaveLength(2);
  });

  it("renders the failure message and closes on failed", () => {
    render(<Harness jobId={JOB_ID} />);
    const source = FakeEventSource.latest;
    act(() => {
      source.emit("failed", event("failed", { error: { message: "Boom", retryable: true } }), "1");
    });
    expect(screen.getByText("failed — Boom")).toBeInTheDocument();
    expect(source.closed).toBe(true);
  });

  it("closes the previous stream when the job id changes and on unmount", () => {
    const { rerender, unmount } = render(<Harness jobId={JOB_ID} />);
    const first = FakeEventSource.latest;
    rerender(<Harness jobId={WORKSPACE_ID} />);
    expect(first.closed).toBe(true);
    const second = FakeEventSource.latest;
    expect(second).not.toBe(first);
    unmount();
    expect(second.closed).toBe(true);
  });

  it("reports an error only when the browser gives up (CLOSED)", () => {
    render(<Harness jobId={JOB_ID} />);
    const source = FakeEventSource.latest;
    act(() => source.fail());
    expect(screen.getByTestId("status")).toHaveTextContent("error");
  });
});
