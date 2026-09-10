import { describe, expect, it } from "bun:test";
import { generationRun, RUN_UP_TO, runEvent, runEvents, withTerminal } from "@/test/play-run";
import { announcedLine, STAGES, stageLine, stageOf, stageStatus } from "./stage";

const strip = (events: Parameters<typeof stageOf>[0]) => {
  const state = stageOf(events);
  return STAGES.map((s) => `${s.id}:${stageStatus(s.id, state)}`).join(" ");
};

describe("stageOf", () => {
  it("is Planning before any event and through 2, 6 and 10", () => {
    expect(stageOf([]).stage).toBe("planning");
    expect(stageLine(stageOf([]))).toBe("Planning");
    expect(strip([])).toBe("planning:live writing:todo checking:todo ready:todo");
    for (const upTo of [3, 4, 5]) {
      const state = stageOf(runEvents(generationRun, upTo));
      expect(state.stage).toBe("planning");
      expect(state.slide).toBeNull();
    }
  });

  it("row 2: 'Slide 1 of 5' ticks Planning and goes live on Writing with the count", () => {
    const state = stageOf(runEvents(generationRun, RUN_UP_TO.writing));
    expect(state.stage).toBe("writing");
    expect(state.slide).toEqual({ n: 1, total: 5 });
    expect(stageLine(state)).toBe("Writing the slides and pictures, 1 of 5");
    expect(strip(runEvents(generationRun, RUN_UP_TO.writing))).toBe(
      "planning:done writing:live checking:todo ready:todo",
    );
  });

  it("85 is the worksheet, still inside Writing", () => {
    const state = stageOf(runEvents(generationRun, RUN_UP_TO.worksheet));
    expect(state.stage).toBe("writing");
    expect(state.worksheet).toBe(true);
    expect(stageLine(state)).toBe("Writing the worksheet");
  });

  it("85 with 'Slides ready' is not the worksheet: the line keeps the last count", () => {
    const events = runEvents(generationRun, RUN_UP_TO.worksheet);
    const last = events.at(-1);
    if (last?.type !== "progress") throw new Error("expected the 85 row");
    events[events.length - 1] = {
      ...last,
      progress: { ...last.progress, message: "Slides ready" },
    };
    const state = stageOf(events);
    expect(state.stage).toBe("writing");
    expect(state.worksheet).toBe(false);
    expect(stageLine(state)).toBe("Writing the slides and pictures, 5 of 5");
  });

  it("announces at a stage boundary and every fourth slide only", () => {
    const at = (upTo: number) => announcedLine(stageOf(runEvents(generationRun, upTo)));
    expect(at(RUN_UP_TO.planning)).toBe("Planning");
    // Slides 1 to 3: the boundary line, no count yet.
    expect(at(RUN_UP_TO.writing)).toBe("Writing the slides and pictures");
    expect(at(RUN_UP_TO.writing + 2)).toBe("Writing the slides and pictures");
    // Slide 4 is announced; slide 5 repeats it.
    expect(at(RUN_UP_TO.writing + 3)).toBe("Writing the slides and pictures, 4 of 5");
    expect(at(RUN_UP_TO.writing + 4)).toBe("Writing the slides and pictures, 4 of 5");
    expect(at(RUN_UP_TO.worksheet)).toBe("Writing the worksheet");
    expect(at(RUN_UP_TO.checking)).toBe("Checking");
  });

  it("row 3: 88 (a picture placed on resume) is still Writing (TEACH-220), 90 Checking, 100 Ready and completed ticks everything", () => {
    expect(strip(runEvents(generationRun, RUN_UP_TO.pictures))).toBe(
      "planning:done writing:live checking:todo ready:todo",
    );
    expect(stageLine(stageOf(runEvents(generationRun, RUN_UP_TO.pictures)))).toBe(
      "Writing the slides and pictures",
    );
    expect(strip(runEvents(generationRun, RUN_UP_TO.checking))).toBe(
      "planning:done writing:done checking:live ready:todo",
    );
    expect(stageLine(stageOf(runEvents(generationRun, RUN_UP_TO.checking)))).toBe("Checking");
    expect(strip(runEvents(generationRun, RUN_UP_TO.checking + 1))).toBe(
      "planning:done writing:done checking:done ready:live",
    );
    const done = stageOf(runEvents(generationRun));
    expect(done.terminal).toBe("completed");
    expect(strip(runEvents(generationRun))).toBe(
      "planning:done writing:done checking:done ready:done",
    );
    expect(stageLine(done)).toBe("Ready to edit");
  });

  it("row 4: a run with no 88 (the photo landed with its slide) goes from Writing to Checking", () => {
    const events = runEvents(generationRun, RUN_UP_TO.checking).filter(
      (e) => !(e.type === "progress" && e.progress.percent === 88),
    );
    expect(strip(events)).toBe("planning:done writing:done checking:live ready:todo");
  });

  it("never goes backwards: a late lower percent keeps the stage reached", () => {
    const events = runEvents(generationRun, RUN_UP_TO.checking);
    const late = runEvent(generationRun, RUN_UP_TO.writing);
    expect(stageOf([...events, late]).stage).toBe("checking");
  });

  it("reads progress.stage when the worker sends one, over the percent", () => {
    const base = runEvent(generationRun, 2);
    if (base.type !== "progress") throw new Error("expected a progress event");
    const withStage = (stage: string, percent: number) =>
      ({ ...base, progress: { ...base.progress, percent, stage } }) as typeof base;
    expect(stageOf([withStage("generate", 2)]).stage).toBe("writing");
    expect(stageOf([withStage("illustrate", 40)]).stage).toBe("writing");
    expect(stageOf([withStage("evaluate", 40)]).stage).toBe("checking");
    expect(stageOf([withStage("repair", 40)]).stage).toBe("checking");
  });

  it("keeps the failure text and the terminal for the stopped states", () => {
    const failed = stageOf(withTerminal(generationRun, RUN_UP_TO.writing + 1, "failed"));
    expect(failed.terminal).toBe("failed");
    expect(failed.failure).toBe("The model timed out.");
    expect(failed.stage).toBe("writing");
    const cancelled = stageOf(withTerminal(generationRun, RUN_UP_TO.writing + 1, "cancelled"));
    expect(cancelled.terminal).toBe("cancelled");
    expect(stageStatus("writing", cancelled)).toBe("live");
  });
});
