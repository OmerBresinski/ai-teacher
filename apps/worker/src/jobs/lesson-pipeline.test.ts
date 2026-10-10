import { describe, expect, test } from "bun:test";
import { waitForWorksheet } from "./lesson-pipeline";

// Ruling 201: the write stage keeps the exit ticket off the slides only when a worksheet row (and
// its job) was actually created for the lesson.
describe("waitForWorksheet", () => {
  const live = () => new AbortController().signal;

  test("true once the lesson page's request has created the worksheet", async () => {
    let polls = 0;
    const list = async () => (++polls >= 3 ? [{ id: "sheet" }] : []);
    expect(await waitForWorksheet(list, live(), { waitMs: 1000, stepMs: 1 })).toBe(true);
    expect(polls).toBe(3);
  });

  test("false when no worksheet was created in time (the request failed or never came)", async () => {
    expect(await waitForWorksheet(async () => [], live(), { waitMs: 20, stepMs: 5 })).toBe(false);
  });

  test("false at once when the job is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    let polls = 0;
    const list = async () => {
      polls++;
      return [];
    };
    expect(await waitForWorksheet(list, controller.signal, { waitMs: 60_000 })).toBe(false);
    expect(polls).toBe(1);
  });
});
